/* The enricher, run by the vault repo's workflow (vault-template/.github/workflows/enrich.yml) after a push:
     node enricher/run.ts --vault <vault dir> [--dry] [--no-claude]
   1. Resources with `enrich: pending` and a url: read the page (title, author, site, image, year, article
      text → .hub/articles/<name>.md); with ANTHROPIC_API_KEY, Claude Haiku writes a summary and suggests
      topics. Captured links (`provisional: true`) are renamed to their title. Failures get `enrich: failed`.
   2. .hub/requests/*.json (Explore): Claude Opus maps the topic into .hub/explore/<topic>.json.
   3. .hub/status.json: when it ran, what it did, what it cost (this month too).
   It only writes files; the workflow commits them. */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildIndex, itemsIn, parseDoc, type Doc } from "../shared/index.ts";
import {
  basename, explorePath, guessType, HUB, isSynced, safeName, setFrontmatter, splitFrontmatter, uniquePath, type ExploreResult,
} from "../shared/vault.ts";
import { Declined, describe, explore, spend } from "./claude.ts";
import { readPage, shortDescription } from "./extract.ts";
import { pool } from "./net.ts";

const args = process.argv.slice(2);
const VAULT = args.includes("--vault") ? args[args.indexOf("--vault") + 1] : ".";
const DRY = args.includes("--dry");
const CLAUDE = !args.includes("--no-claude") && !!process.env.ANTHROPIC_API_KEY;
const MAX_PER_RUN = 40;

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
      if (CLAUDE && (page.text || page.title)) {
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
        summary: fm.summary ?? ai?.summary ?? shortDescription(page.description),
        suggestedTopics: !hasTopics && ai?.topics.length ? ai.topics.map((id) => `[[${id}]]`) : undefined,
        article: articlePath ?? fm.article,
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
  if (!pending.length && !requests.length) { console.log("Nothing to do."); return; }
  const month = new Date().toISOString().slice(0, 7);
  let prev: { month?: string; monthUsd?: number } = {};
  try { prev = JSON.parse(files.get(`${HUB}/status.json`) ?? "{}"); } catch { /* fresh */ }
  const status = {
    at: new Date().toISOString(), enriched, failed, explored, claude: CLAUDE,
    costUsd: Math.round(spend.usd * 10000) / 10000,
    month, monthUsd: Math.round(((prev.month === month ? prev.monthUsd ?? 0 : 0) + spend.usd) * 10000) / 10000,
    error: errors.length ? errors.slice(0, 3).join(" · ") : undefined,
  };
  await save(`${HUB}/status.json`, JSON.stringify(status, null, 2) + "\n");
  console.log(`Done: ${enriched} filled in, ${failed} failed, ${explored} explored, $${spend.usd.toFixed(4)}.`);

  /** What Claude sees about a topic: my overview, subtopics, what I've saved and its status, my notes' titles. */
  function exploreContext(id: string): string {
    const t = index.topics.get(id)!;
    const chain: string[] = [];
    for (let x = index.topics.get(id); x; x = x.parent ? index.topics.get(x.parent) : undefined) chain.unshift(x.name);
    const overview = splitFrontmatter(files.get(t.path) ?? "").body.trim();
    const items = itemsIn(index, id);
    const res = items.filter((d) => d.kind === "resource").slice(0, 120)
      .map((d) => `- ${d.title}${d.resource!.author ? ` (${d.resource!.author})` : ""} · ${d.resource!.type} · ${d.resource!.status}${d.resource!.rating ? ` · rated ${d.resource!.rating}/5` : ""}`);
    const notes = items.filter((d) => d.kind === "note" || d.kind === "path").slice(0, 60).map((d) => `- ${d.title}`);
    const journal = items.filter((d) => d.kind === "journal").length;
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
