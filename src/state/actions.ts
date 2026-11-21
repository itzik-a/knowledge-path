/* Every change the app makes to the vault, in vault terms. Each one writes Markdown files through the
   store, so the same change made in Obsidian looks the same. */
import { topicIdOf } from "../../shared/index.ts";
import {
  addHighlight as addHl, FOLDER, journalPath, replaceHighlight, safeName, setBody, setFrontmatter, splitFrontmatter,
  toggleStep as toggle, todayISO, uniquePath, type Highlight, type ResourceType, type Status,
} from "../../shared/vault.ts";
import { showToast } from "../lib/toast";
import { exists, getIndex, readFile, removeFile, renameFile, taken, writeFile, writeFiles } from "./store";

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
  const d = getIndex().docs.get(path);
  patchResource(path, {
    status,
    finished: status === "done" ? d?.resource?.finished ?? todayISO() : undefined,
    progress: status === "done" ? undefined : d?.resource?.progress,
  });
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
export function removeSuggestions() {
  const ix = getIndex();
  const paths = [...ix.docs.values()].filter((d) => d.resource?.suggested && d.resource.status === "saved" && !d.body.trim()).map((d) => d.path);
  const undos = paths.map((p) => removeFile(p));
  showToast(`Removed ${paths.length} suggestions`, { label: "Undo", run: () => undos.forEach((u) => u()) });
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

export function remove(path: string, label?: string) {
  const name = label ?? getIndex().docs.get(path)?.title ?? path;
  const undo = removeFile(path);
  showToast(`Removed ${name}`, { label: "Undo", run: undo });
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
  const undos = paths.map((p) => removeFile(p));
  showToast(`Removed ${t.name}`, { label: "Undo", run: () => undos.forEach((u) => u()) });
}

/** Edit a topic's overview (its note's body). */
export function setTopicBody(id: string, body: string, opts: { lazy?: boolean } = {}) {
  const t = getIndex().topics.get(id);
  if (t) setBodyOf(t.path, body, opts);
}

// ── explore requests (answered by the enricher in GitHub Actions) ─────
export function requestExplore(topicId: string, ask?: string) {
  const id = `${Date.now().toString(36)}`;
  writeFiles([{ path: `.hub/requests/${id}.json`, content: JSON.stringify({ kind: "explore", topic: topicId, ask: ask?.trim() || undefined, at: new Date().toISOString() }, null, 2) + "\n" }]);
}
