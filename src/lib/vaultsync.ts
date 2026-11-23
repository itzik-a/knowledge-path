/* One sync between this device and the vault repo, independent of the browser so it can be tested
   against a fake GitHub (tests/sync.test.ts).

   For every file, comparing this device's copy (its text, the base it last synced, that base's blob sha,
   dirty or not) with the vault's blob sha:
     same sha, not dirty                → nothing
     same sha, dirty                    → push my change (or my removal)
     vault changed, mine clean          → take the vault's
     vault changed, mine dirty          → three-way merge (base, mine, vault); if lines clash, the vault's copy
                                          keeps the name and mine is saved beside it as "… (conflict <date>).md"
                                          (a sketch merges by strokes: what either side drew or erased)
     vault changed, I removed it        → the vault's edit wins (the file comes back)
     gone from the vault, mine clean    → remove here
     gone from the vault, mine dirty    → push mine again
     never synced (a starter file)      → kept if the vault has it or the vault is empty, dropped otherwise
   Then all pushes go out as one commit. If the vault moved meanwhile, the whole thing runs again.

   A `Codec` (private notes, shared/private.ts) changes text on the way: `open` what comes from the vault
   (decrypt; what it can't open stays as it is), `seal` what goes to it (encrypt; null holds a file back,
   still dirty, e.g. a private note on a device without the passphrase). Everything in between, merges
   included, sees the plain text. */
import { diff3Merge } from "node-diff3";
import { mergeLogLines } from "../../shared/habits.ts";
import { isSketchPath, mergeSketch } from "../../shared/sketch.ts";
import { basename, dirname, isSynced, kindOf, todayISO } from "../../shared/vault.ts";
import type { FileRec } from "../state/db";

export interface Head { commit: string; tree: string }
export interface TreeEntry { path: string; sha: string; size?: number }

export interface Remote {
  /** The branch head, or "unchanged" when it's the same as `known` (a free 304). Makes the first commit in an empty repo. */
  head(known?: string): Promise<Head | "unchanged">;
  tree(treeSha: string): Promise<TreeEntry[]>;
  blob(sha: string): Promise<string>;
  /** One commit on top of `parent`; throws Moved if the branch moved meanwhile. */
  commit(parent: Head, changes: { path: string; content: string | null }[], message: string): Promise<Head>;
}

export class Moved extends Error {}

export interface LocalStore {
  records(): FileRec[];
  get(path: string): FileRec | undefined;
  applyRemote(changes: { path: string; content: string | null; sha?: string; dirty?: boolean; base?: string }[]): void;
  settle(done: { path: string; rev: number; content: string | null; sha?: string }[]): void;
  /** A new local file (a conflict copy), dirty. */
  add(path: string, content: string): void;
}

export interface Codec {
  open(path: string, text: string): Promise<string>;
  seal(path: string, text: string): Promise<string | null>;
}

export interface SyncState { head?: string; tree?: string; files?: Record<string, string> }

export interface SyncResult {
  state: SyncState;
  pulled: number;
  pushed: number;
  conflicts: string[];
  /** Files in the vault the app doesn't keep (images, PDFs): path → sha */
  other: Record<string, string>;
  /** Files not pushed because the codec held them back. */
  held: string[];
}

/** A line-based three-way merge; null when the two sides change the same lines differently.
    With `logs` (habit and recipe files), a clash made only of log lines keeps the days logged on either side. */
export function merge3(base: string, mine: string, theirs: string, opts: { logs?: boolean } = {}): string | null {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  const split = (s: string) => s.split("\n");
  const regions = diff3Merge(split(mine), split(base), split(theirs), { excludeFalseConflicts: true });
  const out: string[] = [];
  for (const r of regions) {
    if (r.ok) { out.push(...r.ok); continue; }
    // Edits to neighbouring lines land in one clash; with the same line count on every side, take each line
    // from whichever side changed it. Only a line changed differently on both sides is a real conflict.
    const { a, o, b } = r.conflict;
    const logs = opts.logs ? mergeLogLines(a, o, b) : null;
    if (logs) { out.push(...logs); continue; }
    if (a.length !== o.length || b.length !== o.length) return null;
    for (let i = 0; i < o.length; i++) {
      if (a[i] === o[i]) out.push(b[i]);
      else if (b[i] === o[i] || a[i] === b[i]) out.push(a[i]);
      else return null;
    }
  }
  return out.join("\n");
}

export function conflictPath(path: string, taken: (p: string) => boolean, day = todayISO()): string {
  const dir = dirname(path);
  const ext = path.match(/\.[a-z]+$/i)?.[0] ?? ".md";
  const name = basename(path).replace(new RegExp(`\\${ext}$`), "");
  for (let i = 1; ; i++) {
    const p = `${dir ? dir + "/" : ""}${name} (conflict ${day}${i > 1 ? ` ${i}` : ""})${ext}`;
    if (!taken(p)) return p;
  }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

interface Opts { force?: boolean; message?: string; codec?: Codec }

export async function syncOnce(remote: Remote, local: LocalStore, prev: SyncState, opts: Opts = {}): Promise<SyncResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(remote, local, prev, opts);
    } catch (e) {
      if (!(e instanceof Moved) || attempt >= 3) throw e;
      prev = { ...prev, head: undefined }; // the vault moved under us: read it again
    }
  }
}

async function run(remote: Remote, local: LocalStore, prev: SyncState, opts: Opts): Promise<SyncResult> {
  const codec = opts.codec;
  const dirty = local.records().some((r) => r.dirty && isSynced(r.path));
  const h = await remote.head(opts.force ? undefined : prev.head);
  if (h === "unchanged" && !dirty && prev.files) return { state: prev, pulled: 0, pushed: 0, conflicts: [], other: {}, held: [] };

  const head: Head = h === "unchanged" ? { commit: prev.head!, tree: prev.tree! } : h;
  let entries: TreeEntry[];
  if (head.tree === prev.tree && prev.files) entries = Object.entries(prev.files).map(([path, sha]) => ({ path, sha }));
  else entries = await remote.tree(head.tree);

  const remoteFiles = new Map<string, string>();
  const other: Record<string, string> = {};
  for (const e of entries) (isSynced(e.path) ? remoteFiles.set(e.path, e.sha) : (other[e.path] = e.sha));
  const vaultEmpty = remoteFiles.size === 0;

  // download what changed in the vault
  const need: { path: string; sha: string }[] = [];
  for (const [path, sha] of remoteFiles) {
    const r = local.get(path);
    if (!r || r.baseSha !== sha) need.push({ path, sha });
  }
  const got = new Map<string, string>();
  await pool(need, 8, async ({ path, sha }) => {
    const text = await remote.blob(sha);
    got.set(path, codec ? await codec.open(path, text) : text);
  });

  // decide, using this device's records as they are now (edits may have happened while downloading)
  const apply: Parameters<LocalStore["applyRemote"]>[0] = [];
  const conflicts: string[] = [];
  let pulled = 0;
  for (const [path, sha] of remoteFiles) {
    const r = local.get(path);
    if (r && r.baseSha === sha) continue;
    const theirs = got.get(path)!;
    if (!r || !r.dirty) { apply.push({ path, content: theirs, sha }); if (!r || r.content !== theirs) pulled++; continue; }
    if (r.deleted) { apply.push({ path, content: theirs, sha }); pulled++; continue; }
    if (r.content === theirs) { apply.push({ path, content: theirs, sha }); continue; }
    const merged = (isSketchPath(path) ? mergeSketch(r.base ?? "", r.content, theirs) : null)
      ?? merge3(r.base ?? "", r.content, theirs, { logs: kindOf(path) === "habit" || kindOf(path) === "recipe" });
    if (merged != null) {
      apply.push({ path, content: merged, sha, base: theirs, dirty: merged !== theirs });
      if (merged !== r.content) pulled++;
    } else {
      apply.push({ path, content: theirs, sha });
      const cp = conflictPath(path, (p) => !!local.get(p) || remoteFiles.has(p));
      local.add(cp, r.content);
      conflicts.push(cp);
      pulled++;
    }
  }
  for (const r of local.records()) {
    if (!isSynced(r.path) || remoteFiles.has(r.path)) continue;
    if (r.baseSha) {
      // it was in the vault and now isn't
      if (r.deleted) apply.push({ path: r.path, content: null });
      else if (r.dirty) apply.push({ path: r.path, content: r.content, dirty: true, base: "" });
      else { apply.push({ path: r.path, content: null }); pulled++; }
    } else if (!r.dirty && !r.deleted && !vaultEmpty) {
      apply.push({ path: r.path, content: null }); // a starter file the vault doesn't have
    }
  }
  local.applyRemote(apply);

  // push
  const push = local.records()
    .filter((r) => isSynced(r.path) && (r.dirty || (vaultEmpty && !r.baseSha && !r.deleted)))
    .filter((r) => !(r.deleted && !remoteFiles.has(r.path)))
    .map((r) => ({ path: r.path, rev: r.rev, content: r.deleted ? null : r.content }));
  // what the vault gets (encrypted where it must be); the device keeps what it has
  const out = new Map<string, string | null>();
  const held: string[] = [];
  for (const p of push) {
    const sealed = p.content == null || !codec ? p.content : await codec.seal(p.path, p.content);
    if (sealed == null && p.content != null) held.push(p.path);
    else out.set(p.path, sealed);
  }
  if (held.length) push.splice(0, push.length, ...push.filter((p) => out.has(p.path)));
  let state: SyncState = { head: head.commit, tree: head.tree, files: Object.fromEntries(remoteFiles) };
  if (push.length) {
    const next = await remote.commit(head, push.map(({ path }) => ({ path, content: out.get(path) ?? null })), opts.message ?? commitMessage(push));
    const tree = await remote.tree(next.tree);
    const shas = new Map<string, string>();
    const files: Record<string, string> = {};
    for (const e of tree) if (isSynced(e.path)) { shas.set(e.path, e.sha); files[e.path] = e.sha; }
    local.settle(push.map((p) => ({ ...p, sha: p.content == null ? undefined : shas.get(p.path) })));
    state = { head: next.commit, tree: next.tree, files };
  }
  return { state, pulled, pushed: push.length, conflicts, other, held };
}

function commitMessage(push: { path: string; content: string | null }[]): string {
  const names = push.map((p) => basename(p.path));
  const verb = push.every((p) => p.content == null) ? "Remove" : "Update";
  return push.length <= 3 ? `${verb} ${names.join(", ")}` : `${verb} ${names.slice(0, 2).join(", ")} and ${push.length - 2} more`;
}
