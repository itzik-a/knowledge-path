/* Actions on several selected items at once (the select bar's menu), each with one Undo for the lot. */
import { basename, dirname, FOLDER, kindOf, parseStages, refTarget, safeName, setFrontmatter, splitFrontmatter, strList, uniquePath, type Status } from "../../shared/vault.ts";
import { stampOf } from "../../shared/habits.ts";
import { isPrivate } from "../../shared/private.ts";
import { showToast } from "../lib/toast";
import { getPassphrase } from "../lib/passphrase";
import { openSheet } from "../lib/sheets";
import { setPrivate } from "./privacy";
import { topicLink } from "./actions";
import { getIndex, readFile, removeFiles, renameFile, taken, writeFile, writeFiles } from "./store";

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const STATUS_WORD: Record<Status, string> = { saved: "Saved", next: "Up next", "in-progress": "In progress", done: "Done" };

/** Change each file's text; one batch, one Undo that puts every file back as it was. Returns how many changed. */
function batch(paths: string[], change: (text: string, path: string) => string | null, message: (n: number) => string): number {
  const before: { path: string; content: string }[] = [];
  const after: { path: string; content: string }[] = [];
  for (const path of paths) {
    const c = readFile(path);
    if (c == null) continue;
    const next = change(c, path);
    if (next == null || next === c) continue;
    before.push({ path, content: c });
    after.push({ path, content: next });
  }
  if (!after.length) { showToast("Nothing to change"); return 0; }
  writeFiles(after);
  showToast(message(after.length), { label: "Undo", run: () => writeFiles(before) });
  return after.length;
}

/** What the selection can do, from the kinds of item in it. */
export function bulkKinds(paths: string[]) {
  const kinds = paths.map(kindOf);
  const every = (ok: (k: string) => boolean) => kinds.length > 0 && kinds.every(ok);
  return {
    resources: every((k) => k === "resource"),
    lockable: every((k) => k === "note" || k === "journal"),
    movable: every((k) => k === "note"),
    topical: every((k) => k !== "topic" && k !== "hub"),
  };
}

export function bulkStatus(paths: string[], status: Status) {
  return batch(paths.filter((p) => kindOf(p) === "resource"),
    (c) => (splitFrontmatter(c).fm.status === status ? null : setFrontmatter(c, { status, suggested: undefined })),
    (n) => `${plural(n, "item")} marked ${STATUS_WORD[status]}`);
}

/** Add a topic to each item's `topics:` property, or take it off. (An item that's in a topic through a link or a tag
    in its text keeps it: that's in the text, not the property.) */
export function bulkTopic(paths: string[], id: string, add: boolean) {
  const t = getIndex().topics.get(id);
  if (!t) return 0;
  const isIt = (ref: string) => { const target = refTarget(ref).toLowerCase(); return target === t.name.toLowerCase() || target === id.toLowerCase(); };
  return batch(paths, (c, path) => {
    const fm = splitFrontmatter(c).fm;
    const refs = strList(fm.topics);
    const has = refs.some(isIt);
    if (add === has) return null;
    const next = add ? [...refs, topicLink(id)] : refs.filter((r) => !isIt(r));
    return setFrontmatter(c, { topics: next, suggested: fm.suggested === true && kindOf(path) === "resource" ? undefined : fm.suggested });
  }, (n) => `${add ? "Added" : "Removed"} ${t.name} ${add ? "to" : "from"} ${plural(n, "item")}`);
}

export function bulkPin(paths: string[], on: boolean) {
  const stamp = stampOf(new Date());
  return batch(paths, (c) => {
    const pinned = splitFrontmatter(c).fm.pinned;
    if (on ? pinned != null && pinned !== false : pinned == null) return null;
    return setFrontmatter(c, { pinned: on ? stamp : undefined });
  }, (n) => `${on ? "Pinned" : "Unpinned"} ${plural(n, "item")}`);
}

/** Inbox items kept without a topic (`inbox: false`). */
export function bulkKeepOut(paths: string[]) {
  return batch(paths, (c) => (splitFrontmatter(c).fm.inbox === false ? null : setFrontmatter(c, { inbox: false })),
    (n) => `${plural(n, "item")} kept without a topic`);
}

/** Lock or unlock notes and journal entries (asks for the passphrase first when there's none yet). */
export async function bulkLock(paths: string[], on: boolean): Promise<void> {
  if (on && !getPassphrase()) { openSheet({ kind: "private" }); return; }
  const todo = paths.filter((p) => { const c = readFile(p); return c != null && isPrivate(c) !== on; });
  if (!todo.length) { showToast("Nothing to change"); return; }
  const done: string[] = [];
  for (const p of todo) done.push(await setPrivate(p, on, { quiet: true }));
  showToast(`${on ? "Locked" : "Unlocked"} ${plural(done.length, "note")}`, {
    label: "Undo", run: () => { void (async () => { for (const p of done) await setPrivate(p, !on, { quiet: true }); })(); },
  });
}

/** The folders notes can move to: every folder that holds a note, Notes first. */
export function noteFolders(): string[] {
  const set = new Set<string>([FOLDER.notes]);
  for (const d of getIndex().docs.values()) if (d.kind === "note") set.add(dirname(d.path) || "");
  return [...set].sort((a, b) => (a === FOLDER.notes ? -1 : b === FOLDER.notes ? 1 : a.localeCompare(b)));
}

/** Move notes into a folder (their links follow, as with a rename); Undo moves them back. */
export function bulkMove(paths: string[], folder: string) {
  const dir = folder.split("/").map((s) => safeName(s)).filter(Boolean).join("/");
  const moves: [string, string][] = [];
  for (const from of paths) {
    if (kindOf(from) !== "note" || dirname(from) === dir) continue;
    let to = `${dir ? dir + "/" : ""}${basename(from)}.md`;
    if (taken(to)) to = uniquePath(dir, basename(from), taken);
    if (renameFile(from, to)) moves.push([from, to]);
  }
  if (!moves.length) { showToast("Nothing to move"); return 0; }
  showToast(`Moved ${plural(moves.length, "note")} to ${dir || "the top of the vault"}`, {
    label: "Undo", run: () => { for (const [from, to] of moves) renameFile(to, from); },
  });
  return moves.length;
}

/** A link to each item, by file name: what [[ ]] needs. */
const linkOf = (path: string) => `[[${basename(path)}]]`;

/** Make a new study path from the items (one step each, in the order given), or add them to an existing one.
    Returns the path's file. */
export function bulkToPath(paths: string[], target: { title: string } | { path: string }): string | undefined {
  const steps = paths.map((p) => `- [ ] ${linkOf(p)}`).join("\n");
  if ("path" in target) {
    const c = readFile(target.path);
    if (c == null) return undefined;
    const have = new Set(paths.filter((p) => c.includes(linkOf(p))));
    const add = paths.filter((p) => !have.has(p));
    if (!add.length) { showToast("They're all in that path already"); return target.path; }
    // a roadmap in stages gets them as a stage of their own at the end, not tucked into its last stage
    const staged = parseStages(splitFrontmatter(c).body).stages.length > 0;
    const head = staged ? `\n## Added ${new Date().toISOString().slice(0, 10)}\n` : "";
    writeFile(target.path, c.replace(/\n*$/, "\n") + head + add.map((p) => `- [ ] ${linkOf(p)}`).join("\n") + "\n");
    showToast(`Added ${plural(add.length, "step")} to ${basename(target.path)}`, { label: "Undo", run: () => writeFile(target.path, c) });
    return target.path;
  }
  const title = target.title.trim();
  if (!title) return undefined;
  const file = uniquePath(FOLDER.paths, title, taken);
  // the topic every item shares, if there is one
  const ix = getIndex();
  const shared = paths.map((p) => new Set(ix.topicsOf.get(p) ?? [])).reduce<Set<string> | null>((acc, s) => (acc ? new Set([...acc].filter((x) => s.has(x))) : s), null);
  const topics = shared ? [...shared].slice(0, 1).map(topicLink) : [];
  writeFile(file, setFrontmatter("", { topics, created: new Date().toISOString().slice(0, 10) }) + steps + "\n");
  showToast(`Made the study path “${basename(file)}”`, { label: "Undo", run: () => { removeFiles([file]); } });
  return file;
}

/** Copy the items as a Markdown list: [[links]], or titles with their web address (for a message). */
export async function bulkCopy(paths: string[], as: "links" | "urls") {
  const ix = getIndex();
  const lines = paths.map((p) => {
    const d = ix.docs.get(p);
    if (as === "links" || !d) return `- ${linkOf(p)}`;
    const url = d.resource?.url;
    return `- ${d.title}${url ? `: ${url}` : ""}`;
  });
  try {
    await navigator.clipboard.writeText(lines.join("\n") + "\n");
    showToast(`Copied ${plural(lines.length, as === "links" ? "link" : "item")}`);
  } catch {
    showToast("Couldn't copy (the browser said no)");
  }
}
