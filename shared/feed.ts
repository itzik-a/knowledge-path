/* The feed (from Feed Path, merged in): sources and topics I follow, read and scored by the collector (feed/), and
   reviewed in the Inbox's Feed tab before anything becomes part of the knowledge base. DOM- and Node-free (the app,
   the collector and the tests use it).

   Where things live:
   - .hub/feed/settings.json (vault, written by the app): sources, topics, days to keep, automatic runs. One source or
     topic a line; devices merge it item by item (`mergeFeedSettings`, used by the sync).
   - .hub/feed/marks.json (vault, written by the app): per entry id, kept / dismissed and 👍 / 👎, one a line, merged
     entry by entry (`mergeFeedMarks`).
   - .hub/requests/feed-<id>.json (vault, written by the app's Run now): its push starts the vault's Feed workflow.
   - The `feed` branch of the vault repo (written only by the collector): feed.json (entries, filtered headlines,
     source health, runs, answered requests) and collector.json (what it has seen, items waiting for the next
     summary run). Each run replaces the branch with one parentless commit, so the vault's history never holds the
     feed: nothing from it is in the knowledge base until it's kept. */

export const FEED_SETTINGS_PATH = ".hub/feed/settings.json";
export const FEED_MARKS_PATH = ".hub/feed/marks.json";
export const FEED_REQUEST_DIR = ".hub/requests";
export const FEED_REQUEST_PREFIX = "feed-";
export const FEED_BRANCH = "feed";
export const FEED_FILE = "feed.json";
export const STATE_FILE = "collector.json";
/** The workflow the app writes into the vault while automatic runs are on (and deletes when they're turned off). */
export const SCHEDULE_WORKFLOW_PATH = ".github/workflows/feed-schedule.yml";
export const FEED_TZ = "Asia/Jerusalem";

export const isFeedSettingsPath = (p: string) => p === FEED_SETTINGS_PATH;
export const isFeedMarksPath = (p: string) => p === FEED_MARKS_PATH;
export const isFeedRequestPath = (p: string) => p.startsWith(`${FEED_REQUEST_DIR}/${FEED_REQUEST_PREFIX}`) && p.endsWith(".json");
export const feedRequestPath = (id: string) => `${FEED_REQUEST_DIR}/${FEED_REQUEST_PREFIX}${id}.json`;
export const feedRequestId = (p: string) => p.slice(`${FEED_REQUEST_DIR}/${FEED_REQUEST_PREFIX}`.length, -".json".length);

// ── settings (the app writes) ───────────────────────────────────

export type SourceKind = "youtube" | "rss" | "search";
/** Google News edition used by a "search" source. */
export type Edition = "en-US" | "he-IL";

/** Something specific to follow. */
export interface Source {
  id: string;
  kind: SourceKind;
  name: string;
  /** youtube / rss: what I pasted (a channel URL or @handle, a site or feed URL) */
  url?: string;
  /** search: the phrase looked up on Google News */
  query?: string;
  edition?: Edition;
  /** feed topic ids this source usually belongs to: a hint for scoring, not a filter */
  topics?: string[];
  enabled: boolean;
  updatedAt: number;
  deletedAt?: number;
}

/** A subject of interest for the feed (not a knowledge-base topic). Claude scores every new item against each one. */
export interface Topic {
  id: string;
  name: string;
  /** what I care about in it, in my own words */
  description: string;
  /** a story stays out of the feed unless it scores at least this for some topic (0–100) */
  minScore: number;
  enabled: boolean;
  updatedAt: number;
  deletedAt?: number;
}

export interface AutoRuns {
  /** off: the collector runs only when asked (Run now) */
  on: boolean;
  /** summary runs, "HH:MM" Israel time, 1–3 a day */
  times: string[];
  /** read the sources every 3 hours between summary runs (no Claude), so busy feeds don't drop items */
  read: boolean;
}

export interface FeedSettings {
  v: 1;
  sources: Source[];
  topics: Topic[];
  /** unreviewed entries drop out of the feed after this many days */
  keepDays: number;
  auto: AutoRuns;
  /** when keepDays / auto last changed (the newer copy wins in a merge) */
  prefsAt: number;
}

// ── marks (the app writes) ──────────────────────────────────────

export interface Mark {
  /** reviewed: kept (now a saved link) or dismissed; none = still waiting */
  s?: "kept" | "dismissed";
  /** 👍 / 👎 */
  v?: 1 | -1;
  /** the saved link a kept entry became */
  path?: string;
  at: number;
}
export type FeedMarks = Record<string, Mark>;

// ── what the collector writes (the feed branch) ─────────────────

export interface TopicScore { topic: string; score: number }

export interface EntrySource {
  url: string;
  title: string;
  sourceId: string;
  sourceName: string;
  kind: "article" | "video" | "headline";
  publishedAt: number;
  /** what the summary could read: the full text, the feed's excerpt, the video description, or only the headline */
  basis: "full" | "excerpt" | "description" | "headline";
}

/** One story. */
export interface Entry {
  id: string;
  title: string;
  /** one sentence */
  tldr: string;
  bullets: string[];
  /** why it matters for the topic it scored highest on */
  why?: string;
  /** BCP-47 code of the summary's language (the main source's language) */
  lang: string;
  topics: TopicScore[];
  score: number;
  /** every source that covered it, the first one summarized first */
  sources: EntrySource[];
  image?: string;
  publishedAt: number;
  createdAt: number;
  updatedAt: number;
}

/** A headline that scored too low, kept two days so thresholds can be tuned. */
export interface Filtered { title: string; url: string; sourceName: string; score: number; topic?: string; at: number }

export interface SourceHealth {
  lastRun: number;
  ok: boolean;
  items: number;
  newItems: number;
  error?: string;
  feedUrl?: string;
}

export interface RunInfo {
  at: number;
  ms: number;
  candidates: number;
  added: number;
  merged: number;
  dropped: number;
  errors: string[];
  tokens?: { in: number; out: number };
  dry?: boolean;
  /** what started it: Run now (a request), Run workflow by hand, or the schedule */
  kind?: "request" | "manual" | "scheduled";
  /** a scheduled summary run: which time ("09:30"), so it runs once a day */
  slot?: string;
}

export interface FeedFile {
  v: 1;
  /** when the last summary run wrote it */
  updatedAt: number;
  /** when the sources were last read (a reading pass or a summary run) */
  lastRead?: number;
  /** items saved by reading passes, waiting for the next summary run */
  waiting?: number;
  entries: Entry[];
  filtered: Filtered[];
  health: Record<string, SourceHealth>;
  /** newest first, the last 20 */
  runs: RunInfo[];
  /** Run now requests answered: request id → when, how many new entries, or what went wrong */
  requests: Record<string, { at: number; added: number; error?: string }>;
}

/** A new item read from a source, before Claude has looked at it. */
export interface PendingItem {
  key: string;
  sourceId: string;
  sourceName: string;
  kind: "article" | "video" | "headline";
  url: string;
  title: string;
  snippet: string;
  publishedAt: number;
  image?: string;
  hints: string[];
}

export interface CollectorState {
  v: 1;
  /** item key → when Claude looked at it; pruned after a week */
  seen: Record<string, number>;
  /** source id → the feed URL found for what was pasted */
  resolved: Record<string, { input: string; feedUrl: string }>;
  /** items read but not scored yet (reading passes, or a summary run that didn't get to them) */
  pending: PendingItem[];
}

// ── starting topics and sources (never rename or reuse an id: scores, hints, health and marks use them) ──

export const SEED_TOPICS: Topic[] = [
  {
    id: "israel", name: "Israeli news", minScore: 70, enabled: true, updatedAt: 0,
    description: "News about Israel: politics, security, the economy and society. Major developments over routine items.",
  },
  {
    id: "usa", name: "US news", minScore: 70, enabled: true, updatedAt: 0,
    description: "US politics, policy, the economy and major events in the United States.",
  },
  {
    id: "world", name: "Global news", minScore: 70, enabled: true, updatedAt: 0,
    description: "Major international events outside Israel and the US: geopolitics, conflicts, elections, the world economy, disasters.",
  },
  {
    id: "longevity", name: "Longevity & health science", minScore: 55, enabled: true, updatedAt: 0,
    description:
      "Research and developments in longevity, the biology of aging and health: new studies, clinical trials, treatments and evidence-based health findings. Prefer peer-reviewed results and real trials over hype, supplements marketing and lifestyle listicles.",
  },
];

const rss = (id: string, name: string, url: string, topics: string[]): Source => ({ id, kind: "rss", name, url, topics, enabled: true, updatedAt: 0 });

export const SEED_SOURCES: Source[] = [
  rss("ynet", "Ynet", "https://www.ynet.co.il/Integration/StoryRss2.xml", ["israel"]),
  rss("toi", "The Times of Israel", "https://www.timesofisrael.com/feed/", ["israel"]),
  rss("npr", "NPR News", "https://feeds.npr.org/1001/rss.xml", ["usa"]),
  rss("nyt-us", "New York Times · U.S.", "https://rss.nytimes.com/services/xml/rss/nyt/US.xml", ["usa"]),
  rss("bbc-world", "BBC News · World", "https://feeds.bbci.co.uk/news/world/rss.xml", ["world"]),
  rss("nyt-world", "New York Times · World", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", ["world"]),
  rss("sciencedaily-health", "ScienceDaily · Health & Medicine", "https://www.sciencedaily.com/rss/health_medicine.xml", ["longevity"]),
  rss("fightaging", "Fight Aging!", "https://www.fightaging.org/feed/", ["longevity"]),
  rss("lifespan", "Lifespan.io", "https://lifespan.io/feed/", ["longevity"]),
  rss("nature-aging", "Nature Aging", "https://www.nature.com/nataging.rss", ["longevity"]),
  {
    id: "gn-longevity", kind: "search", name: "Google News · longevity research", query: "longevity OR \"aging research\" study",
    edition: "en-US", topics: ["longevity"], enabled: true, updatedAt: 0,
  },
];

export const DEFAULT_AUTO: AutoRuns = { on: false, times: ["09:30"], read: true };
export const DEFAULT_KEEP_DAYS = 10;

export function seedFeedSettings(): FeedSettings {
  return { v: 1, sources: structuredClone(SEED_SOURCES), topics: structuredClone(SEED_TOPICS), keepDays: DEFAULT_KEEP_DAYS, auto: { ...DEFAULT_AUTO, times: [...DEFAULT_AUTO.times] }, prefsAt: 0 };
}

// ── reading the files (anything missing or broken falls back, so an older or hand-edited copy still loads) ──

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = <T extends object>(v: unknown): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : ({} as T));
const json = (text: string | null | undefined): unknown => { if (!text) return undefined; try { return JSON.parse(text); } catch { return undefined; } };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeSettings(raw: unknown): FeedSettings {
  const seed = seedFeedSettings();
  if (!raw || typeof raw !== "object") return seed;
  const x = raw as Partial<FeedSettings>;
  const a = obj<Partial<AutoRuns>>(x.auto);
  const times = arr<string>(a.times).filter((t) => typeof t === "string" && TIME.test(t));
  return {
    v: 1,
    sources: Array.isArray(x.sources) ? x.sources : seed.sources,
    topics: Array.isArray(x.topics) ? x.topics : seed.topics,
    keepDays: typeof x.keepDays === "number" && x.keepDays >= 1 ? Math.round(x.keepDays) : DEFAULT_KEEP_DAYS,
    auto: { on: a.on === true, times: times.length ? [...new Set(times)].sort().slice(0, 3) : [...DEFAULT_AUTO.times], read: a.read !== false },
    prefsAt: typeof x.prefsAt === "number" ? x.prefsAt : 0,
  };
}
export const parseFeedSettings = (text: string | null | undefined) => normalizeSettings(json(text));

export function parseMarks(text: string | null | undefined): FeedMarks {
  const x = obj<Record<string, unknown>>(json(text));
  const out: FeedMarks = {};
  for (const [id, m] of Object.entries(x)) {
    if (!m || typeof m !== "object") continue;
    const k = m as Partial<Mark>;
    out[id] = {
      ...(k.s === "kept" || k.s === "dismissed" ? { s: k.s } : {}),
      ...(k.v === 1 || k.v === -1 ? { v: k.v } : {}),
      ...(typeof k.path === "string" ? { path: k.path } : {}),
      at: typeof k.at === "number" ? k.at : 0,
    };
  }
  return out;
}

export function normalizeFeed(raw: unknown): FeedFile {
  const x = obj<Partial<FeedFile>>(raw);
  return {
    v: 1, updatedAt: x.updatedAt ?? 0, lastRead: x.lastRead, waiting: x.waiting,
    entries: arr(x.entries), filtered: arr(x.filtered), health: obj(x.health), runs: arr(x.runs), requests: obj(x.requests),
  };
}
export const parseFeed = (text: string | null | undefined) => normalizeFeed(json(text));

export function normalizeState(raw: unknown): CollectorState {
  const x = obj<Partial<CollectorState>>(raw);
  return { v: 1, seen: obj(x.seen), resolved: obj(x.resolved), pending: arr(x.pending) };
}

// ── writing them: one item a line, so a three-way merge (and a person reading a diff) sees item by item ──

const line = (v: unknown) => JSON.stringify(v);
const list = (xs: unknown[]) => (xs.length ? `[\n${xs.map(line).join(",\n")}\n]` : "[]");

export function serializeSettings(s: FeedSettings): string {
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return `{\n"v": 1,\n"keepDays": ${s.keepDays},\n"auto": ${line(s.auto)},\n"prefsAt": ${s.prefsAt},\n"topics": ${list(byId(s.topics))},\n"sources": ${list(byId(s.sources))}\n}\n`;
}

/** Marks a line each, oldest first; ones older than `keepMs` (default 60 days) are dropped: their entries are long gone. */
export function serializeMarks(m: FeedMarks, now = Date.now(), keepMs = 60 * 86_400_000): string {
  const rows = Object.entries(m).filter(([, x]) => x.at >= now - keepMs).sort((a, b) => a[1].at - b[1].at || (a[0] < b[0] ? -1 : 1));
  return rows.length ? `{\n${rows.map(([id, x]) => `${line(id)}: ${line(x)}`).join(",\n")}\n}\n` : "{}\n";
}

// ── merging two devices' copies (the sync calls these instead of a line merge) ──

function mergeItems<T extends { id: string; updatedAt: number }>(a: T[], b: T[]): T[] {
  const out = new Map<string, T>();
  for (const x of a) out.set(x.id, x);
  for (const y of b) { const x = out.get(y.id); if (!x || (y.updatedAt || 0) > (x.updatedAt || 0)) out.set(y.id, y); }
  return [...out.values()];
}

/** Sources and topics item by item (the newer `updatedAt` wins, deletes too); days to keep and automatic runs from
    the copy that changed them last. `base` isn't needed: every item carries its own time. */
export function mergeFeedSettings(_base: string, mine: string, theirs: string): string {
  const a = parseFeedSettings(mine), b = parseFeedSettings(theirs);
  const prefs = b.prefsAt > a.prefsAt ? b : a;
  return serializeSettings({ v: 1, sources: mergeItems(a.sources, b.sources), topics: mergeItems(a.topics, b.topics), keepDays: prefs.keepDays, auto: prefs.auto, prefsAt: prefs.prefsAt });
}

/** Entry by entry: the mark changed last wins. */
export function mergeFeedMarks(_base: string, mine: string, theirs: string, now = Date.now()): string {
  const a = parseMarks(mine), b = parseMarks(theirs);
  const out: FeedMarks = { ...a };
  for (const [id, y] of Object.entries(b)) { const x = out[id]; if (!x || y.at > x.at) out[id] = y; }
  return serializeMarks(out, now);
}

// ── the review queue ────────────────────────────────────────────

/** Entries still waiting for a decision (not kept or dismissed), newest first. */
export const waitingEntries = (feed: FeedFile, marks: FeedMarks) =>
  feed.entries.filter((e) => !marks[e.id]?.s).sort((a, b) => b.publishedAt - a.publishedAt);

/** The text a kept entry's saved link starts with: the summary's points, why it matters, and every source. */
export function keptNotes(e: Entry): string {
  const out: string[] = [];
  if (e.bullets.length) out.push(e.bullets.map((b) => `- ${b}`).join("\n"));
  if (e.why) out.push(`**Why it matters:** ${e.why}`);
  if (e.sources.length > 1) out.push(`Covered by: ${e.sources.map((s) => `[${s.sourceName}](${s.url})`).join(" · ")}`);
  return out.join("\n\n");
}

// ── when automatic runs happen ──────────────────────────────────

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: FEED_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Local date (YYYY-MM-DD) and minutes since midnight in Israel. */
export function localParts(t: number): { date: string; min: number } {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** a summary time still counts as due this long after it (GitHub starts scheduled runs late, sometimes by an hour) */
const LATE = 180;

/** The summary time due at `now`: the latest one at or before now (local time, within 3 hours), unless it ran today. */
export function slotDue(now: number, times: string[], runs: Pick<RunInfo, "at" | "slot">[]): string | undefined {
  const here = localParts(now);
  const t = [...times].sort().reverse().find((x) => here.min >= toMin(x) && here.min < toMin(x) + LATE);
  if (!t) return undefined;
  return runs.some((r) => r.slot === t && localParts(r.at).date === here.date) ? undefined : t;
}

/** Cron lines (UTC) for the settings: each summary time at both of Israel's offsets (UTC+2 in winter, UTC+3 in
    summer; the collector runs only the one that matches local time), and the 3-hourly reading. */
export function cronLines(auto: AutoRuns): string[] {
  const out = new Set<string>();
  for (const t of auto.times) {
    const h = Number(t.slice(0, 2)), m = Number(t.slice(3, 5));
    for (const off of [3, 2]) out.add(`${m} ${(h - off + 24) % 24} * * *`);
  }
  if (auto.read) out.add("45 */3 * * *");
  return [...out];
}

/** The next summary run after `now` (approximate: GitHub can start it some minutes late). */
export function nextSummary(now: number, auto: AutoRuns): number | undefined {
  if (!auto.on || !auto.times.length) return undefined;
  let best: number | undefined;
  const d = new Date(now);
  for (let day = 0; day <= 2; day++) {
    for (const t of auto.times) {
      for (const off of [3, 2]) {
        const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + day, Number(t.slice(0, 2)) - off, Number(t.slice(3, 5)));
        if (at > now && localParts(at).min === toMin(t) && (best == null || at < best)) best = at;
      }
    }
  }
  return best;
}

/** The steps every Feed workflow shares: the vault, the app's code, Node, then the collector with `args`. */
export function workflowSteps(args: string): string {
  return `    steps:
      - uses: actions/checkout@v7
      - uses: actions/checkout@v7
        with:
          repository: itzik-a/knowledge-path
          path: .app
      - uses: actions/setup-node@v7
        with:
          node-version-file: .app/.nvmrc
          cache: npm
          cache-dependency-path: .app/package-lock.json
      - run: npm ci --prefix .app --no-audit --no-fund
      - name: Read, score and summarize the feed
        run: node .app/feed/run.ts --vault . ${args}
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`;
}

/** The scheduled workflow the app writes into the vault while automatic runs are on. */
export function scheduleWorkflow(auto: AutoRuns): string {
  const crons = cronLines(auto).map((c) => `    - cron: "${c}"`).join("\n");
  return `name: Feed (automatic)

# Written by Knowledge Path while the feed's automatic runs are on (Inbox → Feed → Settings); turning them off
# deletes it. Edit the times there, not here: the app rewrites this file.
# Summary runs at ${auto.times.join(", ")} Israel time${auto.read ? ", and reading the sources every 3 hours between them" : ""}.
# Cron is in UTC and Israel changes its clocks, so each time is listed at both offsets; the collector runs only the
# one that matches local time. The feed goes to the vault's \`feed\` branch, never to main.
on:
  schedule:
${crons}

permissions:
  contents: write

concurrency:
  group: feed
  cancel-in-progress: false

jobs:
  feed:
    runs-on: ubuntu-latest
    timeout-minutes: 15
${workflowSteps("--scheduled")}`;
}
