/* The enricher, run by the vault repo's workflow (vault-template/.github/workflows/enrich.yml) after a push:
     node enricher/run.ts --vault <vault dir> [--dry] [--no-claude]
   1. Resources with `enrich: pending` and a url: read the page (title, author, site, image, year, article
      text → .hub/articles/<name>.md); with ANTHROPIC_API_KEY, Claude Haiku writes a summary and suggests
      topics. Captured links (`provisional: true`) are renamed to their title. Failures get `enrich: failed`.
      A saved link whose page has a recipe gets `recipe: true` (the app offers to make it a recipe).
   1b. Recipes with `enrich: pending` and a `source`: the page's schema.org Recipe data (Claude Haiku reads the
      page when it has none) fills in an empty recipe, its servings, times, photo and tags; a recipe saved from a
      link alone (`provisional: true`) is renamed to the dish's name.
   1c. Resources with `book: pending` (rsarchive.org links, "Make it a book" in the app): the book or lecture
      cycle is fetched (enricher/book.ts) into chapter notes in Books/<Title (GA n)>/ and an EPUB in .hub/books/,
      and the resource gets book, chapters, epub (and type, author, translator, ga, image, summary if missing).
      Nothing from rsarchive.org goes to Claude (its robots.txt asks for reference use only).
   2. .hub/requests/*.json (Explore): Claude Opus maps the topic into .hub/explore/<topic>.json.
   3. .hub/status.json: when it ran, what it did, what it cost (this month too).
   It only writes files; the workflow commits them. */
import { existsSync } from "node:fs";
import { isRsarchive } from "../shared/books.ts";
import { GENERIC_SUMMARY, importBook } from "./book.ts";
import { httpFetcher } from "./rsarchive/net.ts";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildIndex, itemsIn, parseDoc, type Doc } from "../shared/index.ts";
import {
  basename, explorePath, kindOf, guessType, HUB, isSynced, safeName, setBody, setFrontmatter, splitFrontmatter, uniquePath, type ExploreResult,
} from "../shared/vault.ts";
import { fillRecipe } from "../shared/recipes.ts";
import { Declined, describe, explore, extractRecipe, spend } from "./claude.ts";
import type { Imported } from "./recipe.ts";
import { readPage, shortDescription } from "./extract.ts";
import { pool } from "./net.ts";

const args = process.argv.slice(2);
const VAULT = args.includes("--vault") ? args[args.indexOf("--vault") + 1] : ".";
const DRY = args.includes("--dry");
const CLAUDE = !args.includes("--no-claude") && !!process.env.ANTHROPIC_API_KEY;
const MAX_PER_RUN = 40;
const MAX_BOOKS_PER_RUN = 3;

async function walk(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(dir, base), { withFileTypes: true })) {
    const p = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!/^(\.git|\.app|node_modules|\.obsidian|\.trash)$/.test(e.name)) out.push(...(await walk(dir, p))); }
    else if (isSynced(p)) out.push(p);
  }
  return out;
}

const files = new Map<string, string>();
async function save(path: string, content: string) {
  files.set(path, content);
  if (DRY) { console.log(`  (dry) would write ${path}`); return; }
  await mkdir(join(VAULT, path, ".."), { recursive: true });
  await writeFile(join(VAULT, path), content);
}

async function main() {
  for (const p of await walk(VAULT)) files.set(p, await readFile(join(VAULT, p), "utf8"));
  const ix = () => buildIndex(new Map([...files].filter(([p]) => p.endsWith(".md")).map(([p, c]) => [p, parseDoc(p, c)] as [string, Doc])));
  const index = ix();
  const topics = index.topicOrder.map((id) => { const t = index.topics.get(id)!; return { id, name: t.name, description: t.description }; });
  console.log(`Vault: ${files.size} files, ${topics.length} topics. Claude: ${CLAUDE ? "on" : "off"}.`);

  // ── 1. saved links ──────────────────────────────────────────
  const pending = [...index.docs.values()].filter((d) => d.kind === "resource" && d.fm.enrich === "pending").slice(0, MAX_PER_RUN);
  let enriched = 0, failed = 0;
  const errors: string[] = [];
  await pool(pending, 4, async (d) => {
    const url = d.resource?.url;
    let text = files.get(d.path)!;
    if (!url) { await save(d.path, setFrontmatter(text, { enrich: undefined })); return; }
    try {
      const page = await readPage(url);
      let ai: Awaited<ReturnType<typeof describe>> | null = null;
      // rsarchive.org asks that its text not be used as AI input (robots.txt Content-Signal): no Claude for it
      const askClaude = CLAUDE && !isRsarchive(url);
      if (askClaude && (page.text || page.title)) {
        try { ai = await describe(topics, { url, title: page.title, site: page.site, author: page.author, text: page.text || page.title || "" }); }
        catch (e) { if (!(e instanceof Declined)) throw e; console.warn(`  ${d.name}: ${(e as Error).message}`); }
      }
      const fm = d.fm;
      const title = (ai?.title || page.title || "").trim();
      const hasTopics = d.topicRefs.length > 0 || index.topicsOf.has(d.path);
      let articlePath: string | undefined;
      // the new name (captured links), then the article file named after it
      let path = d.path;
      if (fm.provisional === true && title) {
        const taken = (p: string) => p !== d.path && (files.has(p) || existsSync(join(VAULT, p)));
        path = uniquePath("Resources", title, taken);
      }
      if (page.markdown && page.markdown.length > 400) {
        articlePath = `${HUB}/articles/${basename(path)}.md`;
        await save(articlePath, `# ${title || basename(path)}\n\nSource: <${page.url}>\n\n${page.markdown}\n`);
      }
      text = setFrontmatter(text, {
        title: path !== d.path && safeName(title) !== title ? title : fm.title,
        type: fm.provisional === true ? ai?.type ?? guessType(url) ?? fm.type : fm.type ?? ai?.type,
        author: fm.author ?? ai?.author ?? page.author,
        site: fm.site ?? page.site,
        year: fm.year ?? page.year,
        image: fm.image ?? page.image,
        summary: fm.summary ?? ai?.summary ?? (isRsarchive(url) && GENERIC_SUMMARY.test(page.description ?? "") ? undefined : shortDescription(page.description)),
        suggestedTopics: !hasTopics && ai?.topics.length ? ai.topics.map((id) => `[[${id}]]`) : undefined,
        article: articlePath ?? fm.article,
        recipe: page.recipe ? true : fm.recipe,
        enrich: "done",
        enrichError: undefined,
        provisional: undefined,
      });
      if (path !== d.path) {
        console.log(`  rename ${d.path} → ${path}`);
        files.delete(d.path);
        if (!DRY) await rename(join(VAULT, d.path), join(VAULT, path));
      }
      await save(path, text);
      enriched++;
      console.log(`  ✓ ${basename(path)}${ai ? ` · ${ai.topics.join(", ") || "no topic"}` : ""}`);
    } catch (e) {
      failed++;
      const msg = (e as Error).message.slice(0, 120);
      errors.push(`${d.name}: ${msg}`);
      console.warn(`  ✗ ${d.name}: ${msg}`);
      await save(d.path, setFrontmatter(text, { enrich: "failed", enrichError: msg, provisional: undefined }));
    }
  });

  // ── 1b. recipes ─────────────────────────────────────────────
  const recipes = [...index.docs.values()].filter((d) => d.kind === "recipe" && d.fm.enrich === "pending").slice(0, MAX_PER_RUN);
  let recipesDone = 0;
  await pool(recipes, 4, async (d) => {
    const url = d.recipe?.source;
    let text = files.get(d.path)!;
    if (!url) { await save(d.path, setFrontmatter(text, { enrich: undefined })); return; }
    try {
      const page = await readPage(url);
      let found: Imported | undefined = page.recipe;
      if (!found && CLAUDE && page.text) {
        try {
          const x = await extractRecipe({ url, title: page.title, text: page.text });
          if (x.found && (x.ingredients.length || x.steps.length)) {
            found = { title: x.title || undefined, intro: x.intro ?? undefined, servings: x.servings ?? undefined, prep: x.prep ?? undefined, cook: x.cook ?? undefined, tags: [], ingredients: x.ingredients, steps: x.steps };
          }
        } catch (e) { if (!(e instanceof Declined)) throw e; console.warn(`  ${d.name}: ${(e as Error).message}`); }
      }
      const fm = d.fm;
      const title = (found?.title || page.title || "").trim();
      let path = d.path;
      if (fm.provisional === true && title) {
        const taken = (p: string) => p !== d.path && (files.has(p) || existsSync(join(VAULT, p)));
        path = uniquePath("Recipes", title, taken);
      }
      const why = found ? undefined : CLAUDE ? "no recipe on the page" : "no recipe data on the page (Claude can read it once ANTHROPIC_API_KEY is set)";
      text = setFrontmatter(text, {
        title: path !== d.path && safeName(title) !== title ? title : fm.title,
        servings: fm.servings ?? found?.servings,
        prep: fm.prep ?? found?.prep,
        cook: fm.cook ?? found?.cook,
        total: fm.total ?? found?.total,
        image: fm.image ?? found?.image ?? page.image,
        site: fm.site ?? page.site,
        author: fm.author ?? found?.author,
        tags: fm.tags ?? (found?.tags.length ? found.tags : undefined),
        enrich: found ? "done" : "failed",
        enrichError: why,
        provisional: undefined,
      });
      if (found) text = setBody(text, fillRecipe(splitFrontmatter(text).body, found));
      if (path !== d.path) {
        console.log(`  rename ${d.path} → ${path}`);
        files.delete(d.path);
        if (!DRY) await rename(join(VAULT, d.path), join(VAULT, path));
      }
      await save(path, text);
      if (found) { recipesDone++; console.log(`  ✓ recipe ${basename(path)}: ${found.ingredients.length} ingredients, ${found.steps.length} steps`); }
      else { failed++; errors.push(`${d.name}: ${why}`); console.warn(`  ✗ recipe ${d.name}: ${why}`); }
    } catch (e) {
      failed++;
      const msg = (e as Error).message.slice(0, 120);
      errors.push(`${d.name}: ${msg}`);
      console.warn(`  ✗ recipe ${d.name}: ${msg}`);
      await save(d.path, setFrontmatter(text, { enrich: "failed", enrichError: msg, provisional: undefined }));
    }
  });

  // ── 1c. books from rsarchive.org ────────────────────────────
  const bookIx = ix(); // after step 1, which may have renamed a captured link
  const books = [...bookIx.docs.values()].filter((d) => d.kind === "resource" && d.fm.book === "pending").slice(0, MAX_BOOKS_PER_RUN);
  let booksDone = 0;
  for (const d of books) {
    let text = files.get(d.path)!;
    const url = d.resource?.url;
    if (!isRsarchive(url)) {
      failed++;
      errors.push(`${d.name}: not an rsarchive.org link`);
      await save(d.path, setFrontmatter(text, { book: "failed", bookError: "Only links to rsarchive.org can be made into a book." }));
      continue;
    }
    try {
      console.log(`  book ${d.name}: ${url}`);
      const r = await importBook(url!, d.name, { fetcher: httpFetcher({ cacheDir: process.env.RSARCHIVE_CACHE ?? null, log: console.log }), log: console.log });
      // chapters from an earlier import of this book that the new one doesn't have
      for (const p of [...files.keys()]) {
        if (p.startsWith(r.folder + "/") && kindOf(p) === "chapter" && !r.notes.has(p)) {
          files.delete(p);
          if (!DRY) await rm(join(VAULT, p), { force: true });
        }
      }
      for (const [p, note] of r.notes) await save(p, note);
      if (!DRY) {
        await mkdir(join(VAULT, r.epubPath, ".."), { recursive: true });
        await writeFile(join(VAULT, r.epubPath), r.epub);
      }
      const fm = d.fm;
      const missing = Object.fromEntries(Object.entries(r.home.missing).filter(([k]) => fm[k] == null || fm[k] === "" || (k === "summary" && GENERIC_SUMMARY.test(String(fm[k]))) || (k === "type" && fm.type !== "book")));
      const n = r.notes.size;
      text = setFrontmatter(text, {
        ...missing,
        ...r.home.always,
        bookError: r.failed.length ? `${r.failed.length} of ${n + r.failed.length} pages couldn't be read` : undefined,
      });
      await save(d.path, text);
      booksDone++;
      console.log(`  ✓ book ${d.name}: ${n} chapters, ${r.book.images.size} images${r.failed.length ? `, ${r.failed.length} pages failed` : ""}`);
    } catch (e) {
      failed++;
      const msg = (e as Error).message.split("\n")[0].slice(0, 160);
      errors.push(`${d.name}: ${msg}`);
      console.warn(`  ✗ book ${d.name}: ${msg}`);
      await save(d.path, setFrontmatter(text, { book: "failed", bookError: msg }));
    }
  }

  // ── 2. explore requests ─────────────────────────────────────
  let explored = 0;
  const requests = [...files.keys()].filter((p) => p.startsWith(`${HUB}/requests/`) && p.endsWith(".json"));
  for (const r of requests) {
    let req: { kind?: string; topic?: string; ask?: string; at?: string; waiting?: string; error?: string };
    try { req = JSON.parse(files.get(r)!); } catch { req = {}; }
    const done = async () => { files.delete(r); if (!DRY) await rm(join(VAULT, r), { force: true }); };
    // the request stays, saying why it wasn't answered; the app shows that, with Try again (a fresh request) and Cancel
    const hold = async (why: { waiting?: string; error?: string }) => {
      const next = JSON.stringify({ kind: req.kind, topic: req.topic, ask: req.ask, at: req.at, ...why }, null, 2) + "\n";
      if (next !== files.get(r)) await save(r, next);
    };
    if (req.kind !== "explore" || !req.topic || !index.topics.has(req.topic)) { await done(); continue; }
    if (req.error) continue; // answered with an error already: waits for Try again or Cancel
    if (!CLAUDE) { console.log(`  explore ${req.topic}: waiting for ANTHROPIC_API_KEY`); await hold({ waiting: "key" }); continue; }
    try {
      const res = await explore(exploreContext(req.topic), req.ask);
      const out: ExploreResult = { topic: req.topic, at: new Date().toISOString(), ask: req.ask, ...res, answer: res.answer ?? undefined };
      await save(explorePath(req.topic), JSON.stringify(out, null, 2) + "\n");
      explored++;
      console.log(`  ✓ explored ${req.topic}`);
      await done();
    } catch (e) {
      const msg = e instanceof Declined ? "Claude declined to answer this one." : (e as Error).message.slice(0, 200);
      errors.push(`Explore ${req.topic}: ${msg.slice(0, 120)}`);
      console.warn(`  ✗ explore ${req.topic}: ${(e as Error).message}`);
      await hold({ error: msg });
    }
  }

  // ── 3. status ───────────────────────────────────────────────
  if (!pending.length && !recipes.length && !books.length && !requests.length) { console.log("Nothing to do."); return; }
  const month = new Date().toISOString().slice(0, 7);
  let prev: { month?: string; monthUsd?: number } = {};
  try { prev = JSON.parse(files.get(`${HUB}/status.json`) ?? "{}"); } catch { /* fresh */ }
  const status = {
    at: new Date().toISOString(), enriched, recipes: recipesDone, books: booksDone, failed, explored, claude: CLAUDE,
    costUsd: Math.round(spend.usd * 10000) / 10000,
    month, monthUsd: Math.round(((prev.month === month ? prev.monthUsd ?? 0 : 0) + spend.usd) * 10000) / 10000,
    error: errors.length ? errors.slice(0, 3).join(" · ") : undefined,
  };
  await save(`${HUB}/status.json`, JSON.stringify(status, null, 2) + "\n");
  console.log(`Done: ${enriched} filled in, ${recipesDone} recipes, ${booksDone} books, ${failed} failed, ${explored} explored, $${spend.usd.toFixed(4)}.`);

  /** What Claude sees about a topic: my overview, subtopics, what I've saved and its status, my notes' titles (not private ones). */
  function exploreContext(id: string): string {
    const t = index.topics.get(id)!;
    const chain: string[] = [];
    for (let x = index.topics.get(id); x; x = x.parent ? index.topics.get(x.parent) : undefined) chain.unshift(x.name);
    const overview = splitFrontmatter(files.get(t.path) ?? "").body.trim();
    const items = itemsIn(index, id);
    const res = items.filter((d) => d.kind === "resource").slice(0, 120)
      .map((d) => `- ${d.title}${d.resource!.author ? ` (${d.resource!.author})` : ""} · ${d.resource!.type} · ${d.resource!.status}${d.resource!.rating ? ` · rated ${d.resource!.rating}/5` : ""}`);
    // private notes stay out of it altogether, titles included
    const notes = items.filter((d) => (d.kind === "note" || d.kind === "path") && !d.private).slice(0, 60).map((d) => `- ${d.title}`);
    const journal = items.filter((d) => d.kind === "journal" && !d.private).length;
    return [
      `Topic: ${chain.join(" › ")}`,
      t.description ? `Description: ${t.description}` : "",
      overview ? `Their overview:\n${overview.slice(0, 4000)}` : "",
      t.children.length ? `Its subtopics: ${t.children.map((c) => index.topics.get(c)!.name).join(", ")}` : "",
      res.length ? `Saved (${res.length}):\n${res.join("\n")}` : "Nothing saved yet.",
      notes.length ? `Notes and study paths:\n${notes.join("\n")}` : "",
      journal ? `Journal entries mentioning it: ${journal}` : "",
    ].filter(Boolean).join("\n\n");
  }
}

await main();
