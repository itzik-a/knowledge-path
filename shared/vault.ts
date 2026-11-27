/* The vault format: plain Markdown files, the way Obsidian writes them.
   Used by the app and by the enricher, so it stays free of DOM and Node APIs.

   Folders give a file its kind:
     Topics/Philosophy.md, Topics/Philosophy/Stoicism.md   a topic and its subtopic (the folder is the parent)
     Resources/<title>.md                                    a saved resource (frontmatter: type, url, status, …)
     Journal/2026/2026-11-21.md                              a daily journal entry
     Paths/<title>.md                                        a study path (a checklist of [[links]])
     Habits/<name>.md                                        a habit and its log (see habits.ts)
     Recipes/<name>.md                                       a recipe: ingredients, steps, the days cooked (see recipes.ts)
     Books/<book>/<NN chapter>.md                            a chapter of a book imported from rsarchive.org (see books.ts)
     anything else .md                                       a note
     .hub/…                                                  app data (saved article text, explore results); hidden in Obsidian
   An item is in a topic when its `topics:` frontmatter names it, when it links to the topic's note,
   or when it has the topic's tag (#stoicism or #philosophy/stoicism). */
import { Document, isMap, parse, parseDocument } from "yaml";

export type Kind = "topic" | "resource" | "journal" | "path" | "habit" | "recipe" | "chapter" | "note" | "hub";

export const FOLDER = { topics: "Topics", resources: "Resources", journal: "Journal", paths: "Paths", habits: "Habits", recipes: "Recipes", books: "Books", notes: "Notes" } as const;
export const HUB = ".hub";

/** Paths the app keeps in step with the vault: notes, and SVG drawings (text, so they sync like notes).
    Everything else (photos, PDFs, .obsidian settings, the workflow) is left alone. */
export function isSynced(path: string): boolean {
  if (/(^|\/)\.(obsidian|git|github|trash)(\/|$)/.test(path) || path.startsWith(".git") || path === "README.md") return false;
  if (path.startsWith(HUB + "/")) return /\.(md|json)$/.test(path);
  return path.endsWith(".md") || /\.svg$/i.test(path);
}

export function kindOf(path: string): Kind {
  if (path.startsWith(HUB + "/") || path === "README.md") return "hub";
  const top = path.split("/")[0];
  if (top === FOLDER.topics) return "topic";
  if (top === FOLDER.resources) return "resource";
  if (top === FOLDER.paths) return "path";
  if (top === FOLDER.habits && path.split("/").length === 2) return "habit";
  if (top === FOLDER.recipes && path.split("/").length === 2) return "recipe";
  if (top === FOLDER.books && path.split("/").length === 3) return "chapter";
  if (top === FOLDER.journal && JOURNAL_RE.test(basename(path))) return "journal";
  return "note";
}

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
export const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

// ── Frontmatter ───────────────────────────────────────────────

const FM_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export interface Split { fm: Record<string, unknown>; raw: string | null; body: string }

export function splitFrontmatter(text: string): Split {
  const m = FM_RE.exec(text);
  if (!m) return { fm: {}, raw: null, body: text };
  let fm: Record<string, unknown> = {};
  try {
    const v = parse(m[1] ?? "");
    if (v && typeof v === "object" && !Array.isArray(v)) fm = v as Record<string, unknown>;
  } catch { /* broken YAML: show the file, ignore its properties */ }
  return { fm, raw: m[1] ?? "", body: text.slice(m[0].length) };
}

/** Change some frontmatter keys (undefined removes one), keeping the rest, their order and comments. */
export function setFrontmatter(text: string, patch: Record<string, unknown>): string {
  const m = FM_RE.exec(text);
  const body = m ? text.slice(m[0].length) : text;
  let doc: Document;
  try {
    doc = m && m[1] ? parseDocument(m[1]) : new Document({});
    if (doc.errors.length || (doc.contents && !isMap(doc.contents))) doc = new Document({});
  } catch { doc = new Document({}); }
  if (!doc.contents) doc.contents = doc.createNode({}) as Document["contents"];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) doc.delete(k);
    else doc.set(k, v);
  }
  const map = doc.contents as { items?: unknown[] } | null;
  if (!map?.items?.length) return body;
  const yaml = doc.toString({ lineWidth: 0 }).replace(/\n+$/, "");
  return `---\n${yaml}\n---\n${body}`;
}

// ── Created and updated ───────────────────────────────────────

/** Kinds whose files carry an `updated:` stamp (local time, "2026-11-27T17:40"), set by the app when their text changes.
    Created is `created:` (notes) or `added:` (saved links), a date. */
const STAMPED = new Set(["note", "resource"]);
/** Keys whose change alone isn't an update. */
const QUIET = ["updated", "pinned", "inbox"];

/** The file as it should be written: with `updated: now` when this changes a note's or saved link's text (not only
    its pin or Inbox flag). A new file, a file whose stamp the caller changed itself (Undo puts the old one back) and
    a file with broken frontmatter are left as they are. */
export function withUpdated(path: string, before: string | undefined, after: string, now: string): string {
  if (before === undefined || before === after || !STAMPED.has(kindOf(path))) return after;
  const a = splitFrontmatter(before), b = splitFrontmatter(after);
  if (b.raw != null && b.raw.trim() && !Object.keys(b.fm).length) return after;
  if (String(a.fm.updated ?? "") !== String(b.fm.updated ?? "")) return after;
  const core = (x: Split) => { const fm = { ...x.fm }; for (const k of QUIET) delete fm[k]; return JSON.stringify(fm) + "\n" + x.body; };
  if (core(a) === core(b)) return after;
  return setFrontmatter(after, { updated: now });
}

/** The file with `updated: now`, when it's a kind that carries the stamp (a renamed note). */
export function touchUpdated(path: string, text: string, now: string): string {
  if (!STAMPED.has(kindOf(path))) return text;
  const x = splitFrontmatter(text);
  if (x.raw != null && x.raw.trim() && !Object.keys(x.fm).length) return text;
  return setFrontmatter(text, { updated: now });
}

/** Two copies of a file whose `updated:` stamps differ, merged by the caller with the stamps left out: the text
    without its stamp, and the later stamp to put back. Undefined unless both have one and they differ. */
export function splitUpdated(mine: string, theirs: string): { strip: (s: string) => string; later: string } | undefined {
  const um = splitFrontmatter(mine).fm.updated, ut = splitFrontmatter(theirs).fm.updated;
  if (um == null || ut == null || String(um) === String(ut)) return undefined;
  const strip = (s: string) => {
    const m = FM_RE.exec(s);
    if (!m) return s;
    return m[0].replace(/^updated:.*\r?\n/m, "") + s.slice(m[0].length);
  };
  return { strip, later: String(um) > String(ut) ? String(um) : String(ut) };
}

/** Replace the body (everything after the frontmatter). */
export function setBody(text: string, body: string): string {
  const m = FM_RE.exec(text);
  return m ? text.slice(0, m[0].length) + body : body;
}

// ── Links and tags ────────────────────────────────────────────

export interface Link { target: string; heading?: string; alias?: string; embed: boolean }

/** Text with fenced code blocks and inline code blanked out (same length, so offsets still match). */
export function withoutCode(s: string): string {
  return s
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]+`/g, (m) => " ".repeat(m.length));
}

export function parseLinkInner(inner: string): Omit<Link, "embed"> {
  const [left, alias] = splitOnce(inner, "|");
  const [target, heading] = splitOnce(left, "#");
  return { target: target.trim(), heading: heading?.trim() || undefined, alias: alias?.trim() || undefined };
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

export const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;

export function extractLinks(body: string): Link[] {
  const s = withoutCode(body);
  const out: Link[] = [];
  for (const m of s.matchAll(WIKILINK_RE)) {
    const l = parseLinkInner(m[2]);
    if (l.target) out.push({ ...l, embed: m[1] === "!" });
  }
  // [text](Some%20Note.md) links to other notes
  for (const m of s.matchAll(/(?<!!)\[[^\]\n]*\]\(([^)\s]+\.md)(#[^)\s]*)?\)/g)) {
    if (/^[a-z]+:/i.test(m[1])) continue;
    let target = m[1];
    try { target = decodeURIComponent(target); } catch { /* keep */ }
    out.push({ target: target.replace(/\.md$/i, ""), embed: false });
  }
  return out;
}

export const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

export function extractTags(body: string, fm: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const m of withoutCode(body).matchAll(TAG_RE)) out.add(m[2].toLowerCase().replace(/\/+$/, ""));
  for (const t of strList(fm.tags)) out.add(t.replace(/^#/, "").toLowerCase());
  out.delete("");
  return [...out];
}

/** A frontmatter value as a list of strings: "a", ["a", "b"], "a, b", and unquoted [[x]] (which YAML reads as nested lists). */
export function strList(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === "string") return v.includes(",") && !v.includes("[[") ? v.split(",").map((x) => x.trim()).filter(Boolean) : [v.trim()].filter(Boolean);
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) {
    return v.flatMap((x) => {
      if (Array.isArray(x) && x.length === 1 && Array.isArray(x[0]) && x[0].length === 1) return [`[[${String(x[0][0])}]]`];
      return typeof x === "string" || typeof x === "number" ? [String(x).trim()] : [];
    }).filter(Boolean);
  }
  return [];
}

/** "[[Stoicism|Stoics]]" or "Stoicism" → "Stoicism" */
export const refTarget = (ref: string) => parseLinkInner(ref.trim().replace(/^\[\[|\]\]$/g, "")).target;

// ── Names and paths ───────────────────────────────────────────

/** A title made safe as a file name on every system (and in Obsidian links). */
export function safeName(title: string): string {
  const s = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 100)
    .trim();
  return s || "Untitled";
}

/** `folder/name.md`, or `folder/name 2.md` if taken. */
export function uniquePath(folder: string, title: string, taken: (path: string) => boolean): string {
  const name = safeName(title);
  const pre = folder ? folder + "/" : "";
  let p = `${pre}${name}.md`;
  for (let i = 2; taken(p); i++) p = `${pre}${name} ${i}.md`;
  return p;
}

export const slug = (s: string) => s.toLowerCase().trim().replace(/[\s_]+/g, "-");

// ── Journal ───────────────────────────────────────────────────

const JOURNAL_RE = /^\d{4}-\d{2}-\d{2}$/;

export const journalPath = (date: string) => `${FOLDER.journal}/${date.slice(0, 4)}/${date}.md`;
export const journalDate = (path: string) => (JOURNAL_RE.test(basename(path)) ? basename(path) : undefined);

// ── Resources ─────────────────────────────────────────────────

export const RESOURCE_TYPES = ["article", "video", "book", "podcast", "paper", "course", "site", "other"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export const STATUSES = ["saved", "next", "in-progress", "done"] as const;
export type Status = (typeof STATUSES)[number];

export interface Resource {
  type: ResourceType;
  url?: string;
  author?: string;
  status: Status;
  progress?: number;
  rating?: number;
  added?: string;
  finished?: string;
  image?: string;
  site?: string;
  year?: string;
  summary?: string;
  suggested: boolean;
  enrich?: "pending" | "done" | "failed";
  enrichError?: string;
  /** "Summarise" was tapped: the enricher asks Claude for a summary (and topics) on its next run */
  summarize?: "pending";
  suggestedTopics: string[];
  provisional: boolean;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function resourceOf(fm: Record<string, unknown>): Resource {
  const progress = num(fm.progress);
  const rating = num(fm.rating);
  return {
    type: oneOf(RESOURCE_TYPES, fm.type, "other"),
    url: str(fm.url),
    author: str(fm.author),
    status: oneOf(STATUSES, fm.status, "saved"),
    progress: progress == null ? undefined : Math.max(0, Math.min(100, Math.round(progress))),
    rating: rating == null ? undefined : Math.max(0, Math.min(5, Math.round(rating))),
    added: str(fm.added),
    finished: str(fm.finished),
    image: str(fm.image),
    site: str(fm.site),
    year: str(fm.year),
    summary: str(fm.summary),
    suggested: fm.suggested === true,
    enrich: fm.enrich === "pending" || fm.enrich === "done" || fm.enrich === "failed" ? fm.enrich : undefined,
    enrichError: str(fm.enrichError),
    summarize: fm.summarize === "pending" ? "pending" : undefined,
    suggestedTopics: strList(fm.suggestedTopics).map(refTarget),
    provisional: fm.provisional === true,
  };
}

/** A resource type from its URL, when it's obvious. */
export function guessType(url: string): ResourceType | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  const h = u.hostname.replace(/^www\.|^m\./, "");
  if (/(^|\.)youtube\.com$|^youtu\.be$|(^|\.)vimeo\.com$/.test(h)) return "video";
  if (/(^|\.)podcasts\.apple\.com$|^open\.spotify\.com$|(^|\.)overcast\.fm$|(^|\.)pca\.st$/.test(h)) return "podcast";
  if (/\.pdf$/i.test(u.pathname) || /(^|\.)arxiv\.org$|(^|\.)doi\.org$|(^|\.)jstor\.org$|(^|\.)ssrn\.com$/.test(h)) return "paper";
  if (/(^|\.)goodreads\.com$|(^|\.)gutenberg\.org$|^books\.google\./.test(h)) return "book";
  if (/(^|\.)coursera\.org$|(^|\.)edx\.org$|(^|\.)udemy\.com$|^ocw\.mit\.edu$/.test(h)) return "course";
  if (u.pathname === "/" || u.pathname === "") return "site";
  return "article";
}

/** Claude summaries of saved links (`summaries` in .hub/settings.json): for every new link (the default) or only
    the ones I ask for ("ask": a link with `summarize: pending`). Read by the app and by the enricher. */
export const summariesAuto = (settings: Record<string, unknown>) => settings.summaries !== "ask";

/** Should the enricher ask Claude about this link? Never for rsarchive.org (its robots.txt asks for reference use only). */
export function wantsSummary(o: { claude: boolean; auto: boolean; asked: boolean; rsarchive: boolean }): boolean {
  return o.claude && !o.rsarchive && (o.auto || o.asked);
}

/** A readable placeholder title from a URL, until the enricher finds the real one. */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "")
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_+]+/g, " ")
      .trim();
    if (last && /[a-z֐-׿]/i.test(last) && !/^\d+$/.test(last) && last.length > 3) {
      return `${last[0].toUpperCase()}${last.slice(1)} (${host})`.slice(0, 100);
    }
    return host;
  } catch { return url.slice(0, 80); }
}

// ── Highlights (a "## Highlights" section of blockquotes) ─────

export interface Highlight { quote: string; comment?: string; start: number; end: number }

const HL_HEAD = /^##\s+highlights\s*$/i;

/** Line range [start, end) of the Highlights section's content, or null. */
function highlightSection(lines: string[]): [number, number] | null {
  const h = lines.findIndex((l) => HL_HEAD.test(l.trim()));
  if (h < 0) return null;
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) { end = i; break; }
  return [h + 1, end];
}

/** Highlights in a body. start/end are line indexes in the body. */
export function parseHighlights(body: string): Highlight[] {
  const lines = body.split("\n");
  const sec = highlightSection(lines);
  if (!sec) return [];
  const out: Highlight[] = [];
  let i = sec[0];
  while (i < sec[1]) {
    if (!lines[i].startsWith(">")) { i++; continue; }
    const start = i;
    const q: string[] = [];
    while (i < sec[1] && lines[i].startsWith(">")) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
    const c: string[] = [];
    while (i < sec[1] && lines[i].trim() && !lines[i].startsWith(">")) { c.push(lines[i]); i++; }
    out.push({ quote: q.join("\n").trim(), comment: c.join("\n").trim() || undefined, start, end: i });
  }
  return out;
}

const hlBlock = (quote: string, comment?: string) =>
  [...quote.trim().split("\n").map((l) => `> ${l}`.trimEnd()), ...(comment?.trim() ? comment.trim().split("\n") : [])];

/** Add a highlight at the end of the Highlights section (made at the end of the body if missing). */
export function addHighlight(body: string, quote: string, comment?: string): string {
  const block = hlBlock(quote, comment);
  const lines = body.split("\n");
  const sec = highlightSection(lines);
  if (!sec) {
    const t = body.replace(/\s+$/, "");
    return `${t ? t + "\n\n" : ""}## Highlights\n\n${block.join("\n")}\n`;
  }
  let at = sec[1];
  while (at > sec[0] && !lines[at - 1].trim()) at--;
  const gapAfter = at < lines.length && lines[at].trim() !== "";
  lines.splice(at, 0, "", ...block, ...(gapAfter ? [""] : []));
  const out = lines.join("\n");
  return out.endsWith("\n") ? out : out + "\n";
}

export function replaceHighlight(body: string, h: Highlight, quote: string | null, comment?: string): string {
  const lines = body.split("\n");
  const block = quote == null ? [] : hlBlock(quote, comment);
  lines.splice(h.start, h.end - h.start, ...block);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ── Study paths and checklists ────────────────────────────────

export interface Step { done: boolean; text: string; link?: string; line: number }

const STEP_RE = /^(\s*)[-*+] \[([ xX])\] (.*)$/;

export function parseSteps(body: string): Step[] {
  const out: Step[] = [];
  body.split("\n").forEach((l, line) => {
    const m = STEP_RE.exec(l);
    if (!m || m[1].length > 0) return;
    const link = /\[\[([^\]\n]+?)\]\]/.exec(m[3]);
    out.push({ done: m[2] !== " ", text: m[3].trim(), link: link ? parseLinkInner(link[1]).target : undefined, line });
  });
  return out;
}

export interface Stage { title: string; text: string; steps: Step[] }

/** A study path in stages (a roadmap): each "## " heading starts a stage with its own text and steps; whatever comes
   before the first heading is the intro. With no "## " heading that has steps under it, `stages` is empty and the path
   is one flat list. */
export function parseStages(body: string): { intro: string; stages: Stage[] } {
  const steps = parseSteps(body);
  const lines = body.split("\n");
  const heads = lines.flatMap((l, i) => (/^## +\S/.test(l) ? [i] : []));
  const textOf = (from: number, to: number) => lines.slice(from, to).filter((l) => !STEP_RE.exec(l)).join("\n").trim();
  const stages = heads.map((h, k) => {
    const end = heads[k + 1] ?? lines.length;
    return { title: lines[h].replace(/^## +/, "").trim(), text: textOf(h + 1, end), steps: steps.filter((s) => s.line > h && s.line < end) };
  });
  if (!stages.some((s) => s.steps.length)) return { intro: textOf(0, lines.length), stages: [] };
  const before = steps.filter((s) => s.line < heads[0]);
  if (before.length) stages.unshift({ title: "", text: "", steps: before });
  return { intro: textOf(0, heads[0]), stages };
}

/** The stage to work on: the first with a step not done (or the last stage when all are done). */
export function currentStage(stages: Stage[]): number {
  const i = stages.findIndex((s) => s.steps.some((x) => !x.done));
  return i >= 0 ? i : stages.length - 1;
}

/** Tick or untick the checkbox on a body line. */
/** Tick or untick the task on `line`. With `sink` (Apple Notes style), the item moves with its sub-items to where the
   unticked items end: a ticked one becomes the first ticked item, an unticked one the last unticked item. "Its list" is the run of task items at
   the same indent around it (a blank line, a plain item or anything less indented ends it). */
export function toggleStep(body: string, line: number, sink = false): string {
  const lines = body.split("\n");
  const m = STEP_RE.exec(lines[line] ?? "");
  if (!m) return body;
  const done = m[2] === " ";
  lines[line] = lines[line].replace(/\[([ xX])\]/, done ? "[x]" : "[ ]");
  if (!sink) return lines.join("\n");

  const ind = m[1].length;
  const indentOf = (l: string) => /^\s*/.exec(l)![0].length;
  const isChild = (i: number) => i < lines.length && lines[i].trim() !== "" && indentOf(lines[i]) > ind;
  const sibling = (i: number) => { const s = STEP_RE.exec(lines[i] ?? ""); return !!s && s[1].length === ind; };
  const blockEnd = (i: number) => { let e = i + 1; while (isChild(e)) e++; return e; };
  // the run: back over siblings and their children, forward the same way
  let start = line;
  for (let i = line - 1; i >= 0; i--) {
    if (sibling(i)) start = i;
    else if (!isChild(i)) break;
  }
  let end = blockEnd(line);
  while (sibling(end)) end = blockEnd(end);

  const item = lines.slice(line, blockEnd(line));
  const rest = [...lines.slice(start, line), ...lines.slice(line + item.length, end)];
  // before the first ticked sibling, else at the end
  const first = rest.findIndex((l) => { const s = STEP_RE.exec(l); return !!s && s[1].length === ind && s[2] !== " "; });
  rest.splice(first >= 0 ? first : rest.length, 0, ...item);
  lines.splice(start, end - start, ...rest);
  return lines.join("\n");
}

/** The first heading or line of a body, as a fallback title. */
export function firstLine(body: string): string {
  const l = body.split("\n").map((x) => x.trim()).find((x) => x && !x.startsWith("---"));
  return (l ?? "").replace(/^#+\s*/, "").slice(0, 100);
}

/** A short plain-text excerpt of a body (no markup, links as their text). */
export function excerpt(body: string, max = 160): string {
  const s = withoutCode(body)
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(WIKILINK_RE, (_m, _e, inner: string) => { const l = parseLinkInner(inner); return l.alias ?? l.target; })
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+] (\[[ xX]\] )?/gm, "")
    .replace(/[*_~=]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** Re-point every [[Old]] / [[Old|alias]] / [[Old#h]] link in a text to New. */
export function renameLinks(text: string, oldName: string, newName: string): string {
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(!?\\[\\[)(?:[^\\]|#\\n]*/)?${esc}((?:#[^\\]|\\n]*)?(?:\\|[^\\]\\n]*)?\\]\\])`, "gi"), `$1${newName}$2`);
}

export const isHttpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\/\S+$/i.test(u.trim());

export const todayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Where the enricher writes a topic's Explore answer. */
export const explorePath = (topicId: string) => `${HUB}/explore/${topicId.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}.json`;

/** What Explore returns (the enricher writes it, the app shows it). */
export interface ExploreResult {
  topic: string;
  at: string;
  model: string;
  ask?: string;
  answer?: string;
  overview: string;
  subtopics: { name: string; why: string }[];
  people: { name: string; years: string; why: string }[];
  timeline: { when: string; what: string }[];
  questions: string[];
  reads: { title: string; author: string; type: ResourceType; level: "intro" | "deeper" | "advanced"; why: string }[];
  next: string;
}
