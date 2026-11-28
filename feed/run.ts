/* The feed collector (from Feed Path), run by the vault's Feed workflows (see vault-template/.github/workflows/feed.yml
   and the scheduled one the app writes, `scheduleWorkflow()` in shared/feed.ts).

   A summary run: read every enabled source (items from the last 48 hours it hasn't seen, plus what reading passes
   saved), triage with Claude (score per feed topic, spot the same story), add new sources to stories already in the
   feed, summarize new stories that reach a topic's threshold, put the rest in "filtered", prune, and write the
   `feed` branch. A reading pass only reads the sources and saves new items for the next summary run.

   node feed/run.ts --vault <dir> --request    Run now: a summary run if a request in .hub/requests/feed-*.json hasn't
                                                been answered yet (else nothing); answers them in feed.json
   node feed/run.ts --vault <dir> --manual     Run workflow by hand: a summary run
   node feed/run.ts --vault <dir> --scheduled  the automatic workflow: nothing while automatic runs are off; a summary
                                                run when one of the summary times is due (once a day each), else a
                                                reading pass if reading every 3 hours is on
   node feed/run.ts --vault <dir> --read-only  a reading pass
   node feed/run.ts [--vault <dir>] --local    feed/out/ instead of the branch, with Claude (ANTHROPIC_API_KEY)
   node feed/run.ts --dry                      feed/out/, no Claude: stub scores and summaries
   node feed/run.ts --vault <dir> --dry …      the branch as usual, with the stubs (for trying the plumbing)
   Without ANTHROPIC_API_KEY a summary run becomes a reading pass (with a warning). */
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { localParts, slotDue, type Entry, type EntrySource, type RunInfo, type Topic, type PendingItem } from "../shared/feed.ts";
import { MODEL, Refused, costUsd, summarize, triage, usage, type Summary, type SummaryDoc, type TriageResult, type TriageStory } from "./claude.ts";
import { extract } from "./extract.ts";
import { readBranch, readFolder, readRequests, readSettings, writeBranch, writeFolder, type Data } from "./files.ts";
import { canonicalUrl, hash, pool } from "./net.ts";
import { readFeed, resolveFeed, sourceInput, type RawItem } from "./sources.ts";

const argv = process.argv.slice(2);
const args = new Set(argv);
const VAULT = argv.includes("--vault") ? argv[argv.indexOf("--vault") + 1] : undefined;
const DRY = args.has("--dry");
/** feed/out/ instead of the branch: --local, or --dry without a vault (--dry with --vault tests the branch, stubbing Claude) */
const LOCAL = args.has("--local") || (DRY && !VAULT);
const OUT = fileURLToPath(new URL("./out/", import.meta.url));
const CLAUDE = !!process.env.ANTHROPIC_API_KEY;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** items published before this are ignored */
const WINDOW = 48 * HOUR;
/** a source's first run only looks back this far, and takes fewer items, so adding one doesn't flood the feed */
const FIRST_WINDOW = 24 * HOUR;
const PER_SOURCE = DRY ? 4 : 40;
const PER_SOURCE_FIRST = DRY ? 4 : 15;
const TRIAGE_BATCH = 50;
const RECENT_STORIES = 200;
const DOCS_PER_STORY = 3;

const now = Date.now();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a waiting item keeps: no full text (the summary run fetches the page), a short excerpt except for videos. */
function slim(it: RawItem): PendingItem {
  const { key, sourceId, sourceName, kind, url, title, snippet, publishedAt, image, hints } = it;
  return { key, sourceId, sourceName, kind, url, title, snippet: kind === "video" ? snippet : snippet.slice(0, 800), publishedAt, image, hints };
}

function dryTriage(cands: RawItem[]): Map<string, TriageResult> {
  return new Map(cands.map((c, i) => [`C${i + 1}`, { sameAs: null, scores: new Map(c.hints.map((h) => [h, 75])) }]));
}
function drySummary(docs: SummaryDoc[]): Summary {
  const d = docs[0];
  const first = (d.text.split(/(?<=[.!?])\s/)[0] || d.title).slice(0, 220);
  return { title: d.title, tldr: first, bullets: [], why: "", lang: /[֐-׿]/.test(d.title) ? "he" : "en" };
}

interface Group { items: RawItem[]; scores: Map<string, number>; entry?: Entry; title: string }

type Plan = { mode: "summary"; kind: NonNullable<RunInfo["kind"]>; slot?: string; requests: string[] } | { mode: "read" } | { mode: "skip"; why: string };

function plan(data: Data): Plan {
  const settings = readSettings(VAULT);
  if (args.has("--request")) {
    const waiting = readRequests(VAULT!).filter((id) => !data.feed.requests[id]);
    return waiting.length ? { mode: "summary", kind: "request", requests: waiting } : { mode: "skip", why: "No Run now request waiting." };
  }
  if (args.has("--scheduled")) {
    if (!settings.auto.on) return { mode: "skip", why: "Automatic runs are off." };
    const slot = slotDue(now, settings.auto.times, data.feed.runs);
    if (slot) return { mode: "summary", kind: "scheduled", slot, requests: [] };
    if (settings.auto.read) return { mode: "read" };
    const here = localParts(now);
    return { mode: "skip", why: `No summary time due (${here.date} ${String(Math.floor(here.min / 60)).padStart(2, "0")}:${String(here.min % 60).padStart(2, "0")} in Israel) and reading between runs is off.` };
  }
  if (args.has("--read-only")) return { mode: "read" };
  return { mode: "summary", kind: "manual", requests: [] };
}

async function summary(path: string, line: string, errors: string[]) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const errs = errors.length ? `\n\n**Errors**\n\n${errors.map((e) => `- ${e}`).join("\n")}` : "";
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${path}\n\n${line}${errs}\n`);
  }
}

async function main() {
  if (!LOCAL && !VAULT) throw new Error("--vault <dir> is needed (or --local / --dry)");
  const data = LOCAL ? readFolder(OUT) : readBranch(VAULT!);
  const save = (message: string) => (LOCAL ? writeFolder(OUT, data) : writeBranch(VAULT!, data, message));
  const { feed } = data;
  let p = plan(data);
  if (p.mode === "skip") { console.log(p.why); return; }
  const requests = p.mode === "summary" ? p.requests : [];
  const noClaude = p.mode === "summary" && !CLAUDE && !DRY;
  if (noClaude) {
    console.log("::warning::ANTHROPIC_API_KEY isn't set in the vault's secrets: reading the sources only.");
    p = { mode: "read" };
  }

  try {
    await run(p, data);
    const added = feed.runs[0]?.at === now ? feed.runs[0].added : 0;
    for (const id of requests) {
      feed.requests[id] = noClaude
        ? { at: now, added: 0, error: "The vault has no ANTHROPIC_API_KEY secret: the sources were read, nothing was summarized" }
        : { at: now, added };
    }
  } catch (e) {
    for (const id of requests) feed.requests[id] = { at: now, added: 0, error: msg(e) };
    if (requests.length) { pruneRequests(data); save(`Feed: run failed`); }
    throw e;
  }
  pruneRequests(data);
  save(p.mode === "read" ? "Feed: read the sources" : `Feed: ${feed.runs[0]?.added ?? 0} new`);
}

const pruneRequests = ({ feed }: Data) => { for (const [id, r] of Object.entries(feed.requests)) if (r.at < now - 7 * DAY) delete feed.requests[id]; };

async function run(p: Exclude<Plan, { mode: "skip" }>, { feed, state }: Data) {
  const settings = readSettings(VAULT);
  const errors: string[] = [];
  const readOnly = p.mode === "read";
  const waiting = new Map(state.pending.filter((x) => !state.seen[x.key] && x.publishedAt >= now - WINDOW).map((x) => [x.key, x]));
  const topics = settings.topics.filter((t) => t.enabled && !t.deletedAt);
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const sources = settings.sources.filter((s) => s.enabled && !s.deletedAt);
  console.log(`${readOnly ? "Reading only" : DRY ? "Dry run" : LOCAL ? "Local run" : `Summary run (${p.mode === "summary" ? p.kind : ""}${p.mode === "summary" && p.slot ? ` ${p.slot}` : ""})`} · ${sources.length} sources · ${topics.length} topics · ${waiting.size} waiting items · model ${readOnly || DRY ? "none" : MODEL}`);

  // 1. sources
  const fresh: RawItem[] = [];
  await pool(sources, 6, async (s) => {
    const prev = feed.health[s.id];
    try {
      const feedUrl = await resolveFeed(s, state.resolved[s.id]);
      if (s.kind !== "search") state.resolved[s.id] = { input: sourceInput(s), feedUrl };
      const items = await readFeed(s, feedUrl);
      const since = now - (prev ? WINDOW : FIRST_WINDOW);
      const news = items.filter((i) => !state.seen[i.key] && !waiting.has(i.key) && i.publishedAt >= since).slice(0, prev ? PER_SOURCE : PER_SOURCE_FIRST);
      fresh.push(...news);
      feed.health[s.id] = { lastRun: now, ok: true, items: items.length, newItems: news.length, feedUrl };
      console.log(`  ${s.name}: ${items.length} in feed, ${news.length} new`);
    } catch (e) {
      feed.health[s.id] = { ...prev, lastRun: now, ok: false, items: prev?.items ?? 0, newItems: 0, error: msg(e) };
      errors.push(`${s.name}: ${msg(e)}`);
      console.log(`  ${s.name}: ERROR ${msg(e)}`);
    }
  });
  const live = new Set(settings.sources.filter((s) => !s.deletedAt).map((s) => s.id));
  for (const id of Object.keys(feed.health)) if (!live.has(id)) delete feed.health[id];

  // The same article can come from two feeds (e.g. NYT U.S. and NYT World): keep one, with both hints.
  const byKey = new Map<string, RawItem>(waiting);
  for (const it of fresh) {
    const had = byKey.get(it.key);
    if (had) had.hints = [...new Set([...had.hints, ...it.hints])];
    else byKey.set(it.key, it);
  }

  if (readOnly) {
    const before = waiting.size;
    state.pending = [...byKey.values()].map(slim);
    feed.lastRead = now;
    feed.waiting = state.pending.length;
    await summary("Feed reading pass", `Read ${sources.length} sources · ${state.pending.length - before} new items saved · ${state.pending.length} waiting for a summary run · ${errors.length} errors · ${Math.round((Date.now() - now) / 1000)} s`, errors);
    return;
  }

  const candidates = [...byKey.values()];
  console.log(`${candidates.length} new items`);

  // 2. triage
  const recentEntries = feed.entries.filter((e) => e.publishedAt >= now - WINDOW).slice(0, RECENT_STORIES);
  const groups: Group[] = recentEntries.map((e) => ({ items: [], scores: new Map(), entry: e, title: e.title }));
  for (let b = 0; b < candidates.length; b += TRIAGE_BATCH) {
    const batch = candidates.slice(b, b + TRIAGE_BATCH);
    const stories: TriageStory[] = groups.map((g, i) => ({ ref: `S${i + 1}`, title: g.title }));
    let result: Map<string, TriageResult>;
    try {
      result = DRY ? dryTriage(batch) : await triage(topics, stories, batch.map((c, i) => ({ ref: `C${i + 1}`, source: c.sourceName, title: c.title, snippet: c.snippet, hints: c.hints })));
    } catch (e) {
      errors.push(`Triage: ${msg(e)}`);
      console.log(`  triage ERROR ${msg(e)}`);
      // A decline would repeat every run, so those items are set aside; other errors leave them for the next run.
      if (e instanceof Refused) for (const it of batch) state.seen[it.key] = now;
      continue;
    }
    const groupOfCand = new Map<string, Group>();
    batch.forEach((item, i) => {
      const ref = `C${i + 1}`;
      const r = result.get(ref);
      if (!r) return; // left out of the reply: tried again next run
      let g: Group | undefined;
      if (r.sameAs?.startsWith("S")) g = groups[Number(r.sameAs.slice(1)) - 1];
      else if (r.sameAs) g = groupOfCand.get(r.sameAs);
      if (!g) { g = { items: [], scores: new Map(), title: item.title }; groups.push(g); }
      g.items.push(item);
      for (const [t, s] of r.scores) g.scores.set(t, Math.max(g.scores.get(t) ?? 0, s));
      groupOfCand.set(ref, g);
    });
  }

  // 3. merge, filter, summarize
  const seen = (it: RawItem) => { state.seen[it.key] = now; };
  const bestTopic = (scores: Map<string, number>) => {
    let best: Topic | undefined, top = -1;
    for (const [id, s] of scores) { const t = topicById.get(id); if (t && s > top) { best = t; top = s; } }
    return { topic: best, score: Math.max(0, top) };
  };
  const passes = (g: Group) => [...g.scores].some(([id, s]) => { const t = topicById.get(id); return !!t && s >= t.minScore; });
  const basisOf = (it: RawItem): EntrySource["basis"] => (it.fullText ? "full" : it.kind === "headline" ? "headline" : it.kind === "video" ? "description" : "excerpt");
  const toSource = (it: RawItem, basis = basisOf(it)): EntrySource =>
    ({ url: it.url, title: it.title, sourceId: it.sourceId, sourceName: it.sourceName, kind: it.kind, publishedAt: it.publishedAt, basis });
  const scoreList = (m: Map<string, number>) => [...m].map(([topic, score]) => ({ topic, score })).sort((a, b) => b.score - a.score);

  let merged = 0, dropped = 0;
  const added: Entry[] = [];
  const toSummarize: Group[] = [];
  for (const g of groups) {
    if (!g.items.length) continue;
    if (g.entry) {
      const e = g.entry;
      for (const it of g.items) {
        if (!e.sources.some((s) => canonicalUrl(s.url) === canonicalUrl(it.url))) { e.sources.push(toSource(it)); merged++; }
        seen(it);
      }
      const all = new Map(e.topics.map((t) => [t.topic, t.score]));
      for (const [t, s] of g.scores) all.set(t, Math.max(all.get(t) ?? 0, s));
      e.topics = scoreList(all);
      e.score = e.topics[0]?.score ?? 0;
      e.updatedAt = now;
    } else if (passes(g)) {
      toSummarize.push(g);
    } else {
      const { topic, score } = bestTopic(g.scores);
      for (const it of g.items) {
        feed.filtered.push({ title: it.title, url: it.url, sourceName: it.sourceName, score, topic: topic?.id, at: now });
        seen(it);
        dropped++;
      }
    }
  }
  console.log(`${toSummarize.length} new stories to summarize, ${merged} merged into existing ones, ${dropped} filtered out`);

  await pool(toSummarize, 4, async (g) => {
    // Main source first: articles / videos before bare headlines, then the earliest.
    const rank = (i: RawItem) => (i.kind === "headline" ? 2 : 1);
    const items = [...g.items].sort((a, b) => rank(a) - rank(b) || a.publishedAt - b.publishedAt);
    const basis = new Map<string, EntrySource["basis"]>();
    const docs: SummaryDoc[] = [];
    let image = items.find((i) => i.image)?.image;
    const used = new Set<string>();
    for (const it of items) {
      if (docs.length >= DOCS_PER_STORY) break;
      if (used.has(it.sourceName)) continue;
      used.add(it.sourceName);
      let text = it.fullText ?? it.snippet;
      let b = basisOf(it);
      if (it.kind === "article" && !it.fullText) {
        try {
          const ex = await extract(it.url);
          if (ex.basis === "full" || ex.text.length > text.length) { text = ex.text; b = ex.basis === "full" ? "full" : "excerpt"; }
          image ??= ex.image;
        } catch { /* the feed's excerpt will do */ }
      }
      if (!text) b = "headline";
      basis.set(it.key, b);
      docs.push({ source: it.sourceName, title: it.title, text, basis: b });
    }
    const { topic } = bestTopic(g.scores);
    try {
      const s = DRY ? drySummary(docs) : await summarize(topic, docs);
      const topicsScored = scoreList(g.scores);
      added.push({
        id: `e_${hash(items[0].key, 12)}`,
        title: s.title || items[0].title,
        tldr: s.tldr,
        bullets: s.bullets,
        why: s.why || undefined,
        lang: s.lang || "en",
        topics: topicsScored,
        score: topicsScored[0]?.score ?? 0,
        sources: items.map((it) => toSource(it, basis.get(it.key))),
        image,
        publishedAt: Math.min(...items.map((i) => i.publishedAt)),
        createdAt: now,
        updatedAt: now,
      });
      for (const it of items) seen(it);
    } catch (e) {
      if (e instanceof Refused) for (const it of items) seen(it);
      errors.push(`Summary of "${items[0].title}": ${msg(e)}`); // other errors: unseen, tried again next run
    }
  });

  // 4. prune
  const keep = now - Math.max(1, settings.keepDays) * DAY;
  feed.entries = [...added, ...feed.entries.filter((e) => e.createdAt >= keep)].sort((a, b) => b.publishedAt - a.publishedAt);
  feed.filtered = feed.filtered.filter((f) => f.at >= now - 2 * DAY).sort((a, b) => b.at - a.at).slice(0, 400);
  for (const [k, t] of Object.entries(state.seen)) if (t < now - 7 * DAY) delete state.seen[k];
  // Items Claude didn't get to (a failed call, left out of a reply) wait for the next summary run.
  state.pending = candidates.filter((c) => !state.seen[c.key] && c.publishedAt >= now - WINDOW).map(slim);
  feed.lastRead = now;
  feed.waiting = state.pending.length;

  const runInfo: RunInfo = {
    at: now, ms: Date.now() - now, candidates: candidates.length, added: added.length, merged, dropped,
    errors: errors.slice(0, 30), tokens: DRY ? undefined : { ...usage }, dry: DRY || undefined, kind: p.kind, slot: p.slot,
  };
  feed.runs = [runInfo, ...feed.runs].slice(0, 20);
  feed.updatedAt = now;

  const kb = Math.round(JSON.stringify(feed).length / 1024);
  const cost = DRY ? "" : ` · ${usage.in.toLocaleString()} tokens in, ${usage.out.toLocaleString()} out ≈ $${costUsd(usage).toFixed(3)}`;
  await summary("Feed summary run", `Added ${added.length} · merged ${merged} · filtered ${dropped} · ${errors.length} errors · ${feed.entries.length} entries (${kb} KB)${cost} · ${Math.round(runInfo.ms / 1000)} s`, errors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
