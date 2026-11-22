/* Every change the app makes to the vault, in vault terms. Each one writes Markdown files through the
   store, so the same change made in Obsidian looks the same. */
import { topicIdOf } from "../../shared/index.ts";
import {
  addHighlight as addHl, FOLDER, journalPath, replaceHighlight, safeName, setBody, setFrontmatter, splitFrontmatter,
  toggleStep as toggle, todayISO, uniquePath, type Highlight, type ResourceType, type Status,
} from "../../shared/vault.ts";
import { fmtAmount, goalText, habitOf, newHabitBody, parseLog, setLogEntry, type Goal } from "../../shared/habits.ts";
import { showToast } from "../lib/toast";
import { confirmAsk } from "../lib/confirm";
import { allRecords, exists, getIndex, readFile, removeFiles, renameFile, taken, writeFile, writeFiles } from "./store";

/** How an item links to a topic in its `topics:` property: by name, or by path when two topics share a name. */
export function topicLink(id: string): string {
  const ix = getIndex();
  const t = ix.topics.get(id);
  if (!t) return `[[${id}]]`;
  const same = [...ix.topics.values()].filter((x) => x.name.toLowerCase() === t.name.toLowerCase());
  const name = id.split("/").pop()!;
  return same.length > 1 || name !== t.name ? `[[${id}|${t.name}]]` : `[[${name}]]`;
}

/** Change frontmatter keys of a file. */
export function patch(path: string, p: Record<string, unknown>, opts: { lazy?: boolean } = {}) {
  const c = readFile(path);
  if (c == null) return;
  writeFile(path, setFrontmatter(c, p), opts);
}

/** A resource touched by me stops being a starter suggestion. */
export function patchResource(path: string, p: Record<string, unknown>) {
  patch(path, { ...p, suggested: undefined });
}

export function setBodyOf(path: string, body: string, opts: { lazy?: boolean } = {}) {
  const c = readFile(path) ?? "";
  writeFile(path, setBody(c, body), opts);
}

/** The topics an item names in its `topics:` property (not the ones it's in through links or tags). */
export function setTopics(path: string, ids: string[]) {
  const c = readFile(path);
  if (c == null) return;
  const { fm } = splitFrontmatter(c);
  const rest: Record<string, unknown> = { topics: ids.map(topicLink) };
  if (fm.suggested === true && path.startsWith(FOLDER.resources + "/")) rest.suggested = undefined;
  writeFile(path, setFrontmatter(c, rest));
}

// ── resources ─────────────────────────────────────────────────
export interface NewResource {
  title: string; url?: string; type: ResourceType; author?: string; topics: string[]; status?: Status;
  notes?: string; image?: string; site?: string; provisional?: boolean;
}

export function createResource(r: NewResource): string {
  const path = uniquePath(FOLDER.resources, r.title, taken);
  const fm: Record<string, unknown> = {
    title: safeName(r.title) !== r.title.trim() ? r.title.trim() : undefined,
    type: r.type, author: r.author, url: r.url, site: r.site, image: r.image,
    topics: r.topics.map(topicLink), status: r.status ?? "saved", added: todayISO(),
    enrich: r.url ? "pending" : undefined,
    provisional: r.provisional || undefined,
  };
  writeFile(path, setFrontmatter("", fm) + (r.notes?.trim() ? r.notes.trim() + "\n" : ""));
  return path;
}

export function setStatus(path: string, status: Status) {
  patchResource(path, { status });
}

/** Retitle a resource or note: renames the file (and its links); keeps a `title:` when the name had to be simplified. */
export function retitle(path: string, title: string): string {
  const t = title.trim();
  if (!t) return path;
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = safeName(t);
  const target = `${folder}/${name}.md`;
  let next = path;
  if (target !== path) {
    next = target.toLowerCase() === path.toLowerCase() || !taken(target) ? target : uniquePath(folder, t, taken);
    renameFile(path, next);
  }
  patch(next, { title: name !== t ? t : undefined, provisional: undefined });
  return next;
}

export function addHighlight(path: string, quote: string, comment?: string) {
  const c = readFile(path) ?? "";
  writeFile(path, setFrontmatter(setBody(c, addHl(splitFrontmatter(c).body, quote, comment)), { suggested: undefined }));
}

export function editHighlight(path: string, h: Highlight, quote: string | null, comment?: string) {
  const c = readFile(path) ?? "";
  writeFile(path, setBody(c, replaceHighlight(splitFrontmatter(c).body, h, quote, comment)));
}

/** Remove the starter resources I haven't touched. */
export async function removeSuggestions() {
  const ix = getIndex();
  const paths = [...ix.docs.values()].filter((d) => d.resource?.suggested && d.resource.status === "saved" && !d.body.trim()).map((d) => d.path);
  if (!paths.length) return;
  if (!(await confirmAsk({ title: `Delete ${paths.length} starter suggestion${paths.length > 1 ? "s" : ""}?`, body: "Only the ones you haven't touched: no notes, still Saved. You can undo for a few seconds after." }))) return;
  const undo = removeFiles(paths);
  showToast(`Deleted ${paths.length} suggestions`, { label: "Undo", run: undo });
}

export const suggestionCount = () => [...getIndex().docs.values()].filter((d) => d.resource?.suggested && d.resource.status === "saved" && !d.body.trim()).length;

// ── notes and journal ─────────────────────────────────────────
export function createNote(o: { title: string; body?: string; topics?: string[]; folder?: string }): string {
  const path = uniquePath(o.folder ?? FOLDER.notes, o.title || "Untitled", taken);
  writeFile(path, setFrontmatter("", { topics: (o.topics ?? []).map(topicLink), created: todayISO() }) + (o.body ?? ""));
  return path;
}

/** A study path. */
export function createPath(title: string, topics: string[]): string {
  const path = uniquePath(FOLDER.paths, title, taken);
  writeFile(path, setFrontmatter("", { topics: topics.map(topicLink), created: todayISO() }) + "- [ ] \n");
  return path;
}

export const journalFor = (date = todayISO()) => journalPath(date);

export function toggleStep(path: string, line: number) {
  const c = readFile(path);
  if (c == null) return;
  const { body } = splitFrontmatter(c);
  writeFile(path, setBody(c, toggle(body, line)));
}


/** Ask first, then delete resources and notes (one or many) with one Undo. Resolves to whether they were deleted. */
export async function deleteDocs(paths: string[], label?: string): Promise<boolean> {
  if (!paths.length) return false;
  const ix = getIndex();
  const docs = paths.map((p) => ix.docs.get(p));
  let name: string;
  if (paths.length === 1) name = label ?? `“${docs[0]?.title ?? paths[0]}”`;
  else {
    const count = (k: (d?: (typeof docs)[number]) => boolean) => docs.filter(k).length;
    const parts = ([
      [count((d) => d?.kind === "resource"), "resource"],
      [count((d) => d?.kind === "note" || d?.kind === "path"), "note"],
      [count((d) => d?.kind === "journal"), "journal entry"],
    ] as [number, string][]).filter(([n]) => n).map(([n, w]) => `${n} ${n > 1 ? (w.endsWith("y") ? w.slice(0, -1) + "ies" : w + "s") : w}`);
    name = parts.length ? parts.join(" and ") : `${paths.length} items`;
  }
  const ok = await confirmAsk({
    title: `Delete ${name}?`,
    body: `${paths.length > 1 ? "They're" : "It's"} deleted from the vault on every device. You can undo for a few seconds after.`,
  });
  if (!ok) return false;
  const undo = removeFiles(paths);
  showToast(`Deleted ${paths.length > 1 ? name : docs[0]?.title ?? name}`, { label: "Undo", run: undo });
  return true;
}

// ── habits ────────────────────────────────────────────────────
export interface HabitFields { name: string; icon?: string; goal: Goal; unit?: string; target?: number; topics: string[]; description?: string }

export function createHabit(f: HabitFields): string {
  const path = uniquePath(FOLDER.habits, f.name, taken);
  const fm = {
    title: safeName(f.name) !== f.name.trim() ? f.name.trim() : undefined,
    icon: f.icon, goal: goalText(f.goal), unit: f.unit, target: f.unit ? f.target : undefined,
    topics: f.topics.map(topicLink), created: todayISO(),
  };
  writeFile(path, setFrontmatter("", fm) + newHabitBody(f.description));
  return path;
}

/** Edit a habit's settings (renaming the file when the name changes). Returns its path. */
export function updateHabit(path: string, f: Omit<HabitFields, "description" | "topics">): string {
  const next = retitle(path, f.name);
  patch(next, { icon: f.icon, goal: goalText(f.goal), unit: f.unit, target: f.unit ? f.target : undefined });
  return next;
}

/** Log a day (or change its amount). */
export function logHabit(path: string, date: string, amount?: number) {
  const c = readFile(path);
  if (c == null) return;
  const { fm, body } = splitFrontmatter(c);
  writeFile(path, setBody(c, setLogEntry(body, date, amount, habitOf(fm).unit)));
}

/** Take a day off the log, with Undo. */
export function unlogHabit(path: string, date: string, label?: string) {
  const c = readFile(path);
  if (c == null) return;
  const { body } = splitFrontmatter(c);
  const was = parseLog(body).find((e) => e.date === date);
  if (!was) return;
  writeFile(path, setBody(c, setLogEntry(body, date, null)));
  const unit = habitOf(splitFrontmatter(c).fm).unit;
  showToast(`Removed ${label ?? date}${was.amount != null ? ` (${fmtAmount(was.amount)}${unit ? ` ${unit}` : ""})` : ""}`, { label: "Undo", run: () => logHabit(path, date, was.amount) });
}

export function setArchived(path: string, archived: boolean) {
  patch(path, { archived: archived || undefined });
  showToast(archived ? "Archived: hidden from Home" : "Back on Home", { label: "Undo", run: () => patch(path, { archived: !archived || undefined }) });
}

// ── topics ────────────────────────────────────────────────────
export interface TopicFields { name: string; icon?: string; color?: number; description?: string }

export function createTopic(parent: string | undefined, f: TopicFields): string {
  const folder = parent ? `${FOLDER.topics}/${parent}` : FOLDER.topics;
  const path = uniquePath(folder, f.name, taken);
  writeFile(path, setFrontmatter("", { icon: f.icon, color: parent ? undefined : f.color, description: f.description }));
  return topicIdOf(path);
}

export function updateTopic(id: string, f: TopicFields): string {
  const ix = getIndex();
  const t = ix.topics.get(id);
  if (!t) return id;
  let path = t.path;
  const name = safeName(f.name);
  if (name && name !== id.split("/").pop()) {
    const target = `${path.slice(0, path.lastIndexOf("/"))}/${name}.md`;
    if (exists(target) && target.toLowerCase() !== path.toLowerCase()) throw new Error(`There's already a topic called ${name} here`);
    renameFile(path, target);
    path = target;
  }
  patch(path, { icon: f.icon, color: t.parent ? undefined : f.color, description: f.description, title: name !== f.name.trim() ? f.name.trim() : undefined });
  return topicIdOf(path);
}

/** Remove a topic and its subtopics. Items in it stay, unsorted if it was their only topic. */
export function removeTopic(id: string) {
  const ix = getIndex();
  const t = ix.topics.get(id);
  if (!t) return;
  const paths = [t.path, ...[...ix.topics.values()].filter((x) => x.id.startsWith(id + "/")).map((x) => x.path)];
  const undo = removeFiles(paths);
  showToast(`Deleted ${t.name}`, { label: "Undo", run: undo });
}

/** Edit a topic's overview (its note's body). */
export function setTopicBody(id: string, body: string, opts: { lazy?: boolean } = {}) {
  const t = getIndex().topics.get(id);
  if (t) setBodyOf(t.path, body, opts);
}

// ── explore requests (answered by the enricher in GitHub Actions) ─────
/** The open Explore request files for a topic (normally one). */
export function exploreRequests(topicId: string): { path: string; ask?: string; waiting?: string; error?: string }[] {
  return allRecords().filter((r) => !r.deleted && r.path.startsWith(".hub/requests/") && r.path.endsWith(".json")).flatMap((r) => {
    try {
      const j = JSON.parse(r.content) as { topic?: string; ask?: string; waiting?: string; error?: string };
      return j.topic === topicId ? [{ path: r.path, ask: j.ask, waiting: j.waiting, error: j.error }] : [];
    } catch { return []; }
  });
}

/** Withdraw a topic's Explore request. */
export function cancelExplore(topicId: string) {
  removeFiles(exploreRequests(topicId).map((r) => r.path));
}

/** Ask Claude about a topic (replacing an earlier request for it that's still open). */
export function requestExplore(topicId: string, ask?: string) {
  cancelExplore(topicId);
  const id = `${Date.now().toString(36)}`;
  writeFiles([{ path: `.hub/requests/${id}.json`, content: JSON.stringify({ kind: "explore", topic: topicId, ask: ask?.trim() || undefined, at: new Date().toISOString() }, null, 2) + "\n" }]);
}
