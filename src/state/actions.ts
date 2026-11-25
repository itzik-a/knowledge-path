/* Every change the app makes to the vault, in vault terms. Each one writes Markdown files through the
   store, so the same change made in Obsidian looks the same. */
import { resolve, topicIdOf } from "../../shared/index.ts";
import { isPrivate, isSealed, newLockedName, withTitle } from "../../shared/private.ts";
import {
  addHighlight as addHl, FOLDER, journalPath, kindOf, replaceHighlight, resourceOf, safeName, setBody, setFrontmatter, splitFrontmatter,
  toggleStep as toggle, todayISO, uniquePath, type Highlight, type ResourceType, type Status,
} from "../../shared/vault.ts";
import { addToLog, endTimerIn, fmtAmount, fmtHours, goalText, habitOf, hoursSince, newHabitBody, parseLog, setLogEntry, stampOf, type Goal } from "../../shared/habits.ts";
import { recipeBody, setCooked } from "../../shared/recipes.ts";
import { sinkCheckedOn } from "./settings";
import { addItems, clearDone, parseShopping, SHOPPING_PATH, type NewItem } from "../../shared/shopping.ts";
import { showToast } from "../lib/toast";
import { deleteVaultBranch } from "./sync";
import { citation } from "../../shared/books.ts";
import { confirmAsk } from "../lib/confirm";
import { sketchesOnlyIn } from "./sketches";
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
  if (isSealed(c)) return; // a private note this device can't read: its encrypted body stays as it is
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
  const c = readFile(path);
  if (c != null && isPrivate(c) && kindOf(path) === "note") {
    if (!isSealed(c)) writeFile(path, withTitle(c, t)); // locked: the file name stays neutral
    return path;
  }
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
/** A new note. `private`: encrypted in the vault from its very first sync (shared/private.ts). */
export function createNote(o: { title: string; body?: string; topics?: string[]; folder?: string; private?: boolean }): string {
  const title = o.title.trim() || "Untitled";
  // a locked note gets a neutral file name, its title goes in the frontmatter (encrypted in the vault)
  const path = uniquePath(o.folder ?? FOLDER.notes, o.private ? newLockedName() : title, taken);
  const text = setFrontmatter("", { topics: (o.topics ?? []).map(topicLink), created: todayISO(), private: o.private || undefined }) + (o.body ?? "");
  writeFile(path, o.private && title !== "Untitled" ? withTitle(text, title) : text);
  return path;
}

/** A study path. */
export function createPath(title: string, topics: string[]): string {
  const path = uniquePath(FOLDER.paths, title, taken);
  writeFile(path, setFrontmatter("", { topics: topics.map(topicLink), created: todayISO() }) + "- [ ] \n");
  return path;
}

export const journalFor = (date = todayISO()) => journalPath(date);

/** Tick a task. In notes, journal entries and topic pages a ticked item sinks to the bottom of its list (the setting in
   Vault & settings); a study path's steps keep their order. */
export function toggleStep(path: string, line: number) {
  const c = readFile(path);
  if (c == null) return;
  const { body } = splitFrontmatter(c);
  const kind = kindOf(path);
  const sink = (kind === "note" || kind === "journal" || kind === "topic") && sinkCheckedOn();
  writeFile(path, setBody(c, toggle(body, line, sink)));
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
      [count((d) => d?.kind === "recipe"), "recipe"],
    ] as [number, string][]).filter(([n]) => n).map(([n, w]) => `${n} ${n > 1 ? (w.endsWith("y") ? w.slice(0, -1) + "ies" : w + "s") : w}`);
    name = parts.length ? parts.join(" and ") : `${paths.length} items`;
  }
  const ok = await confirmAsk({
    title: `Delete ${name}?`,
    body: `${paths.length > 1 ? "They're" : "It's"} deleted from the vault on every device. You can undo for a few seconds after.`,
  });
  if (!ok) return false;
  const undo = removeFiles([...paths, ...sketchesOnlyIn(paths)]); // a note's own sketches go with it
  showToast(`Deleted ${paths.length > 1 ? name : docs[0]?.title ?? name}`, { label: "Undo", run: undo });
  return true;
}

// ── habits ────────────────────────────────────────────────────
export interface HabitFields { name: string; icon?: string; goal: Goal; unit?: string; target?: number; timer?: boolean; card?: boolean; topics: string[]; description?: string }

export function createHabit(f: HabitFields): string {
  const path = uniquePath(FOLDER.habits, f.name, taken);
  const fm = {
    title: safeName(f.name) !== f.name.trim() ? f.name.trim() : undefined,
    icon: f.icon, goal: goalText(f.goal), unit: f.unit, target: f.unit ? f.target : undefined, timer: f.timer || undefined, card: f.card || undefined,
    topics: f.topics.map(topicLink), created: todayISO(),
  };
  writeFile(path, setFrontmatter("", fm) + newHabitBody(f.description));
  return path;
}

/** Edit a habit's settings (renaming the file when the name changes). Returns its path. */
export function updateHabit(path: string, f: Omit<HabitFields, "description" | "topics">): string {
  const next = retitle(path, f.name);
  patch(next, { icon: f.icon, goal: goalText(f.goal), unit: f.unit, target: f.unit ? f.target : undefined, timer: f.timer || undefined, card: f.card || undefined, ...(f.timer ? {} : { started: undefined, length: undefined }) });
  return next;
}

// ── timed habits ──────────────────────────────────────────────
/** Start a timed habit's timer (now, or at a given time, never in the future) for `length` hours (0: open-ended). */
export function startTimer(path: string, length: number, at = new Date()) {
  patch(path, { started: stampOf(new Date(Math.min(at.getTime(), Date.now()))), length });
}

/** A running timer's start and length as the frontmatter has them, to put back on Undo. */
function runningOf(c: string) {
  const fm = splitFrontmatter(c).fm;
  return { started: fm.started, length: fm.length };
}

/** Move a running timer's start (never into the future). */
export function setTimerStart(path: string, at: Date) {
  patch(path, { started: stampOf(new Date(Math.min(at.getTime(), Date.now()))) });
}

/** End the timer: its hours go in today's log line. Undo puts the timer back and today's line as it was. */
export function endTimer(path: string, title: string) {
  const c = readFile(path);
  if (c == null) return;
  const r = endTimerIn(c, new Date());
  if (!r) return;
  const was = runningOf(c);
  if (r.hours <= 0) { patch(path, { started: undefined, length: undefined }); showToast(`${title}: under a minute, not logged`, { label: "Undo", run: () => patch(path, was) }); return; }
  writeFile(path, r.text);
  showToast(`${title}: ${fmtHours(r.hours)} logged`, {
    label: "Undo",
    run: () => {
      const now = readFile(path);
      if (now == null) return;
      const { body } = splitFrontmatter(now);
      const unit = habitOf(splitFrontmatter(now).fm).unit;
      writeFile(path, setFrontmatter(setBody(now, setLogEntry(body, r.date, r.prev ? r.prev.amount : null, unit)), was));
    },
  });
}

/** Stop the timer without logging it: asks first (the confirm modal), then offers Undo. Resolves to whether it was. */
export async function discardTimer(path: string, title: string): Promise<boolean> {
  const started = readFile(path) != null ? habitOf(splitFrontmatter(readFile(path)!).fm).started : undefined;
  if (!started) return false;
  const so = fmtHours(hoursSince(started, new Date()));
  if (!(await confirmAsk({ title: `Discard this ${title} timer?`, body: `${so} so far won't be logged. Ending it instead logs the hours.`, ok: "Discard" }))) return false;
  const c = readFile(path); // read again: it may have changed (or ended on another device) while the question was open
  if (c == null || !habitOf(splitFrontmatter(c).fm).started) return false;
  const was = runningOf(c);
  patch(path, { started: undefined, length: undefined });
  showToast(`${title}: timer discarded`, { label: "Undo", run: () => patch(path, was) });
  return true;
}

/** Log a day (or change its amount). */
export function logHabit(path: string, date: string, amount?: number) {
  const c = readFile(path);
  if (c == null) return;
  const { fm, body } = splitFrontmatter(c);
  writeFile(path, setBody(c, setLogEntry(body, date, amount, habitOf(fm).unit)));
}

/** A finished timer session: its minutes added to the day's (two sessions add up), with Undo. */
export function logSession(path: string, date: string, minutes: number, title: string) {
  const c = readFile(path);
  if (c == null) return;
  const { fm, body } = splitFrontmatter(c);
  const unit = habitOf(fm).unit;
  const r = addToLog(body, date, minutes, unit);
  writeFile(path, setBody(c, r.body));
  const total = (r.prev?.amount ?? 0) + minutes;
  showToast(`${title}: ${fmtAmount(minutes)} ${unit ?? "min"} logged${r.prev?.amount ? ` · ${fmtAmount(total)} ${unit ?? "min"} today` : ""}`, {
    label: "Undo",
    run: () => { const now = readFile(path); if (now != null) writeFile(path, setBody(now, setLogEntry(splitFrontmatter(now).body, date, r.prev ? r.prev.amount : null, unit))); },
  });
}

/** Take a day off the log, with Undo. */
export function unlogHabit(path: string, date: string, label?: string) {
  const c = readFile(path);
  if (c == null) return;
  const { body } = splitFrontmatter(c);
  const was = parseLog(body).find((e) => e.date === date);
  if (!was) return;
  writeFile(path, setBody(c, setLogEntry(body, date, null)));
  const h = habitOf(splitFrontmatter(c).fm);
  const amt = was.amount == null ? "" : h.timer ? fmtHours(was.amount) : `${fmtAmount(was.amount)}${h.unit ? ` ${h.unit}` : ""}`;
  showToast(`Removed ${label ?? date}${amt ? ` (${amt})` : ""}`, { label: "Undo", run: () => logHabit(path, date, was.amount) });
}

export function setArchived(path: string, archived: boolean) {
  patch(path, { archived: archived || undefined });
  showToast(archived ? "Archived: hidden from Home" : "Back on Home", { label: "Undo", run: () => patch(path, { archived: !archived || undefined }) });
}

// ── recipes ───────────────────────────────────────────────────
export interface NewRecipe {
  title: string; topics?: string[]; source?: string; image?: string; site?: string;
  /** the body; a template with empty Ingredients and Steps when missing */
  body?: string;
  /** saved from a link with no title yet: the enricher names it after the page */
  provisional?: boolean;
  /** frontmatter beyond the usual (servings, prep, cook, tags…) */
  more?: Record<string, unknown>;
}

export function createRecipe(r: NewRecipe): string {
  const path = uniquePath(FOLDER.recipes, r.title, taken);
  const fm: Record<string, unknown> = {
    title: safeName(r.title) !== r.title.trim() ? r.title.trim() : undefined,
    ...r.more,
    source: r.source, image: r.image, site: r.site,
    topics: (r.topics ?? []).map(topicLink), added: todayISO(),
    enrich: r.source ? "pending" : undefined,
    provisional: r.provisional || undefined,
  };
  writeFile(path, setFrontmatter("", fm) + (r.body ?? recipeBody()));
  return path;
}

export interface RecipeFields { title: string; servings?: string; prep?: string; cook?: string; source?: string; image?: string; tags: string[] }

/** Edit a recipe's details (renaming the file when the title changes). A new source link is fetched again. Returns its path. */
export function updateRecipe(path: string, f: RecipeFields): string {
  const c = readFile(path);
  if (c == null) return path;
  const { fm } = splitFrontmatter(c);
  const num = (v?: string) => (v && /^\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : v?.trim() || undefined);
  const srcChanged = (f.source?.trim() || undefined) !== (typeof fm.source === "string" ? fm.source : undefined);
  const next = f.title.trim() && f.title.trim() !== getIndex().docs.get(path)?.title ? retitle(path, f.title) : path;
  patch(next, {
    servings: num(f.servings), prep: num(f.prep), cook: num(f.cook),
    source: f.source?.trim() || undefined, image: f.image?.trim() || undefined,
    tags: f.tags.length ? f.tags : undefined,
    ...(srcChanged && f.source?.trim() ? { enrich: "pending", enrichError: undefined } : {}),
  });
  return next;
}

/** A saved link becomes a recipe: the file moves to Recipes/ (same name), the link becomes its source and the enricher
    fills in the recipe from the page; my notes and highlights go under Notes. With Undo. Returns the new path. */
export function makeRecipe(path: string): string | undefined {
  const c = readFile(path);
  if (c == null) return undefined;
  const { fm, body } = splitFrontmatter(c);
  const r = resourceOf(fm);
  const to = uniquePath(FOLDER.recipes, path.slice(path.lastIndexOf("/") + 1, -3), taken);
  if (!renameFile(path, to)) return undefined;
  const notes = body.trim();
  writeFile(to, setFrontmatter("", {
    title: fm.title, source: r.url, image: r.image, site: r.site, author: r.author,
    topics: fm.topics, tags: fm.tags, rating: r.rating, added: r.added ?? todayISO(),
    enrich: r.url ? "pending" : undefined,
  }) + recipeBody({ notes: notes || undefined }));
  // the saved article text isn't needed any more
  const article = typeof fm.article === "string" && exists(fm.article) ? fm.article : undefined;
  const undoArticle = article ? removeFiles([article]) : undefined;
  showToast("Now a recipe", {
    label: "Undo",
    run: () => { if (renameFile(to, path)) writeFile(path, c); undoArticle?.(); },
  });
  return to;
}

// ── books (rsarchive.org) ─────────────────────────────────────
/** Ask the enricher to fetch the book behind a saved rsarchive.org link (it arrives after a sync or two). */
export function makeBook(path: string) {
  const c = readFile(path);
  if (c == null) return;
  patch(path, { book: "pending", bookError: undefined });
  showToast("Fetching the book: it arrives in a few minutes", { label: "Undo", run: () => writeFile(path, c) });
}

/** An EPUB asked of the enricher (enricher/epubs.ts): a request file in .hub/requests/, answered with the
    branch it waits on. Nothing of it is ever committed to the vault's history. */
export interface EpubReq {
  path: string;
  url: string;
  title?: string;
  at?: string;
  ready?: { branch: string; file: string; size: number; title: string; chapters: number; at: string };
  error?: string;
  note?: string;
}

export function epubRequestFor(url: string): EpubReq | undefined {
  for (const r of allRecords()) {
    if (r.deleted || !r.path.startsWith(".hub/requests/") || !r.path.endsWith(".json")) continue;
    try {
      const j = JSON.parse(r.content) as Omit<EpubReq, "path"> & { kind?: string };
      if (j.kind === "epub" && j.url === url) return { ...j, path: r.path };
    } catch { /* not ours */ }
  }
  return undefined;
}

/** Ask for an EPUB of an rsarchive.org page (it's made on GitHub in a few minutes). */
export function requestEpub(url: string, title?: string) {
  const old = epubRequestFor(url);
  if (old) forgetEpub(old);
  const id = `epub-${Date.now().toString(36)}`;
  writeFiles([{ path: `.hub/requests/${id}.json`, content: JSON.stringify({ kind: "epub", url, title, at: new Date().toISOString() }, null, 2) + "\n" }]);
}

/** Done with an EPUB (saved, or not wanted): its request goes, and its branch on GitHub. */
export function forgetEpub(req: EpubReq) {
  removeFiles([req.path]);
  if (req.ready) void deleteVaultBranch(req.ready.branch).catch(() => { /* the enricher clears old branches too */ });
}

/** A passage from a chapter, kept with the book's other highlights, with a link back to its paragraph. */
export function addChapterHighlight(chapterPath: string, quote: string, block?: string) {
  const ix = getIndex();
  const ch = ix.docs.get(chapterPath);
  if (!ch) return;
  const home = ch.chapter?.book ? resolve(ix, ch.chapter.book, chapterPath) : undefined;
  const target = home && ix.docs.get(home)?.kind === "resource" ? home : chapterPath;
  addHighlight(target, quote, target === chapterPath ? undefined : citation(ch, block));
  showToast(target === chapterPath ? "Highlighted" : "Highlighted: it's with the book's highlights");
}

// ── the shopping list ─────────────────────────────────────────
/** Add to the shopping list (the note is made if missing), with Undo. */
export function addToShopping(items: NewItem[], label?: string, quiet = false) {
  const before = readFile(SHOPPING_PATH);
  const body = before != null ? splitFrontmatter(before).body : "";
  const next = addItems(body, items);
  writeFile(SHOPPING_PATH, before != null ? setBody(before, next) : next);
  if (quiet) return;
  showToast(label ?? `Added ${items.length} to the shopping list`, {
    label: "Undo",
    run: () => { if (before == null) removeFiles([SHOPPING_PATH]); else writeFile(SHOPPING_PATH, before); },
  });
}

/** Take the ticked items off the list, with Undo. */
export function clearShopping() {
  const c = readFile(SHOPPING_PATH);
  if (c == null) return;
  const n = parseShopping(splitFrontmatter(c).body).filter((x) => x.done).length;
  if (!n) return;
  writeFile(SHOPPING_PATH, setBody(c, clearDone(splitFrontmatter(c).body)));
  showToast(`Cleared ${n} ticked`, { label: "Undo", run: () => writeFile(SHOPPING_PATH, c) });
}

/** Remove one item, with Undo. */
export function removeShopItem(line: number) {
  const c = readFile(SHOPPING_PATH);
  if (c == null) return;
  const { body } = splitFrontmatter(c);
  const lines = body.split("\n");
  const was = lines[line];
  lines.splice(line, 1);
  writeFile(SHOPPING_PATH, setBody(c, lines.join("\n")));
  showToast("Removed from the list", { label: "Undo", run: () => { const now = readFile(SHOPPING_PATH); if (now == null) return; const ls = splitFrontmatter(now).body.split("\n"); ls.splice(line, 0, was); writeFile(SHOPPING_PATH, setBody(now, ls.join("\n"))); } });
}

export function setRating(path: string, rating?: number) {
  patch(path, { rating: rating || undefined });
}

/** Log a day this recipe was made (or change its note); Undo puts the day back as it was. */
export function logCooked(path: string, date: string, note?: string, prev?: { note?: string } | null) {
  const c = readFile(path);
  if (c == null) return;
  writeFile(path, setBody(c, setCooked(splitFrontmatter(c).body, date, note ?? "")));
  if (prev !== undefined) {
    showToast(prev ? "Note saved" : "Cooked: logged for today", {
      label: "Undo",
      run: () => { const now = readFile(path); if (now != null) writeFile(path, setBody(now, setCooked(splitFrontmatter(now).body, date, prev ? prev.note ?? "" : null))); },
    });
  }
}

/** Take a day off the Cooked log, with Undo. */
export function unlogCooked(path: string, date: string, note?: string) {
  const c = readFile(path);
  if (c == null) return;
  writeFile(path, setBody(c, setCooked(splitFrontmatter(c).body, date, null)));
  showToast(`Removed ${date}`, { label: "Undo", run: () => logCooked(path, date, note) });
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

/** Pin an item (`pinned:` the time, local, so the newest pin comes first) or unpin it; Undo puts back what was there.
    A locked note's frontmatter stays readable, so it can be pinned too. */
export function setPinned(path: string, on: boolean) {
  const c = readFile(path);
  if (c == null) return;
  const before = splitFrontmatter(c).fm.pinned;
  patch(path, { pinned: on ? stampOf(new Date()) : undefined });
  showToast(on ? "Pinned" : "Unpinned", { label: "Undo", run: () => patch(path, { pinned: before ?? undefined }) });
}

/** "Pin" / "Unpin" for a page's More menu. */
export const pinItem = (d: { path: string; pinned?: boolean }) => ({ label: d.pinned ? "Unpin" : "Pin", run: () => setPinned(d.path, !d.pinned) });
