/* The vault in memory: every file's text, its sync bookkeeping, and the index worked out from them.
   Every change made here goes through writeFile / removeFile / renameFile, which mark the file dirty
   for the next sync. Sync itself uses applyRemote() / settle(). */
import { useSyncExternalStore } from "react";
import { buildIndex, parseDoc, type Doc, type Index } from "../../shared/index.ts";
import { SEED } from "../../shared/seed.ts";
import { basename, dirname, isSynced, renameLinks } from "../../shared/vault.ts";
import { loadAll, saveFiles, type FileRec } from "./db";

export type { FileRec };

let files = new Map<string, FileRec>();
let ready = false;
let version = 0;
const docCache = new Map<string, { content: string; mtime: number; doc: Doc }>();

export interface Snapshot { version: number; ready: boolean; index: Index }
let snap: Snapshot = { version: 0, ready: false, index: buildIndex(new Map()) };

const listeners = new Set<() => void>();
const localListeners = new Set<() => void>();

function rebuild() {
  clearTimeout(lazyTimer);
  const docs = new Map<string, Doc>();
  for (const r of files.values()) {
    if (r.deleted || !r.path.endsWith(".md")) continue;
    const c = docCache.get(r.path);
    if (c && c.content === r.content && c.mtime === r.mtime) { docs.set(r.path, c.doc); continue; }
    const doc = parseDoc(r.path, r.content, r.mtime);
    docCache.set(r.path, { content: r.content, mtime: r.mtime, doc });
    docs.set(r.path, doc);
  }
  for (const p of docCache.keys()) if (!docs.has(p)) docCache.delete(p);
  snap = { version: ++version, ready, index: buildIndex(docs) };
  listeners.forEach((l) => l());
}

// ── persistence (batched) ─────────────────────────────────────
const toPut = new Set<string>();
const toDel = new Set<string>();
let flushTimer = 0;
/** Typing is saved in batches; every other change right away (so leaving the app at once loses nothing). */
function persist(paths: string[], batched = false) {
  for (const p of paths) { if (files.has(p)) { toPut.add(p); toDel.delete(p); } else { toDel.add(p); toPut.delete(p); } }
  clearTimeout(flushTimer);
  if (batched) flushTimer = setTimeout(flush, 300) as unknown as number;
  else void flush();
}
export async function flush() {
  clearTimeout(flushTimer);
  if (!persistOn) { toPut.clear(); toDel.clear(); return; }
  const put = [...toPut].map((p) => files.get(p)).filter((r): r is FileRec => !!r);
  const del = [...toDel];
  toPut.clear(); toDel.clear();
  try { await saveFiles(put, del); } catch (e) { console.error("Saving to IndexedDB failed", e); }
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { void flush(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); });
}

let persistOn = true;
/** Tests: keep everything in memory. */
export function memoryOnly() { persistOn = false; }

/** Load the vault from this device; on the very first run, start from the starter vault. */
export async function init() {
  let recs: FileRec[] = [];
  try { if (persistOn) recs = await loadAll(); } catch (e) { console.error("IndexedDB unavailable", e); }
  if (recs.length) {
    files = new Map(recs.map((r) => [r.path, r]));
  } else {
    // Seeded files are clean, with the seed as their base: if the vault has the same file, the first sync
    // matches it; if I edited one before connecting, the edit merges onto the vault's copy.
    files = new Map(Object.entries(SEED).map(([path, content]) => [path, { path, content, base: content, dirty: false, mtime: 0, rev: 0 }]));
    persist([...files.keys()]);
  }
  ready = true;
  rebuild();
}

// ── reading ───────────────────────────────────────────────────
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getSnapshot = () => snap;
export const getIndex = () => snap.index;
export function useVault() { return useSyncExternalStore(subscribe, getSnapshot); }
export function useIndex() { return useVault().index; }
export const readFile = (path: string) => { const r = files.get(path); return r && !r.deleted ? r.content : undefined; };
export const exists = (path: string) => { const r = files.get(path); return !!r && !r.deleted; };
/** True for paths in use or held by an unsynced removal (so a new file doesn't take a name mid-sync). */
export const taken = (path: string) => files.has(path) || [...files.keys()].some((p) => p.toLowerCase() === path.toLowerCase());
export const allRecords = () => [...files.values()];
export const getRecord = (path: string) => files.get(path);

// ── local changes ─────────────────────────────────────────────
export function onLocalChange(l: () => void) { localListeners.add(l); return () => { localListeners.delete(l); }; }
const local = () => localListeners.forEach((l) => l());

let lazyTimer = 0;
/** Create or change a file. `lazy` (typing in the editor): the index catches up a moment later. */
export function writeFile(path: string, content: string, opts: { lazy?: boolean } = {}) {
  const r = files.get(path);
  if (r && !r.deleted && r.content === content) return;
  const now = Date.now();
  files.set(path, r
    ? { ...r, content, deleted: undefined, dirty: true, mtime: now, rev: r.rev + 1 }
    : { path, content, dirty: true, mtime: now, rev: 1 });
  persist([path], !!opts.lazy);
  clearTimeout(lazyTimer);
  if (opts.lazy && r && !r.deleted) lazyTimer = setTimeout(rebuild, 400) as unknown as number;
  else rebuild();
  local();
}

/** Change several files at once (one rebuild). */
export function writeFiles(changes: { path: string; content: string }[]) {
  const now = Date.now();
  const touched: string[] = [];
  for (const { path, content } of changes) {
    const r = files.get(path);
    if (r && !r.deleted && r.content === content) continue;
    files.set(path, r ? { ...r, content, deleted: undefined, dirty: true, mtime: now, rev: r.rev + 1 } : { path, content, dirty: true, mtime: now, rev: 1 });
    touched.push(path);
  }
  if (!touched.length) return;
  persist(touched);
  rebuild();
  local();
}

/** Remove a file. Returns an undo. */
export function removeFile(path: string): () => void {
  return removeFiles([path]);
}

/** Remove several files at once (one index rebuild); the returned function puts them all back. */
export function removeFiles(paths: string[]): () => void {
  const before: FileRec[] = [];
  for (const path of new Set(paths)) {
    const r = files.get(path);
    if (!r || r.deleted) continue;
    before.push({ ...r });
    if (r.baseSha) files.set(path, { ...r, deleted: true, dirty: true, rev: r.rev + 1 });
    else files.delete(path); // never synced: nothing to remove from the vault
  }
  if (!before.length) return () => {};
  const touched = before.map((r) => r.path);
  persist(touched);
  rebuild();
  local();
  return () => {
    for (const r of before) {
      const now = files.get(r.path);
      files.set(r.path, { ...r, rev: (now?.rev ?? r.rev) + 1, dirty: r.dirty || !!now?.dirty });
    }
    persist(touched);
    rebuild();
    local();
  };
}

/** Rename (or move) a file and re-point [[links]] to it in every other file. */
export function renameFile(from: string, to: string): boolean {
  const r = files.get(from);
  if (!r || r.deleted || from === to || (exists(to) && from.toLowerCase() !== to.toLowerCase())) return false;
  const content = r.content;
  const oldName = basename(from), newName = basename(to);
  // remove the old path (kept as a removal if it was synced)
  if (r.baseSha) files.set(from, { ...r, deleted: true, dirty: true, rev: r.rev + 1 });
  else files.delete(from);
  const prev = files.get(to);
  files.set(to, prev ? { ...prev, content, deleted: undefined, dirty: true, mtime: Date.now(), rev: prev.rev + 1 } : { path: to, content, dirty: true, mtime: Date.now(), rev: 1 });
  const touched = [from, to];
  if (oldName !== newName) {
    for (const f of files.values()) {
      if (f.deleted || !f.path.endsWith(".md")) continue;
      const next = renameLinks(f.content, oldName, newName);
      if (next !== f.content) { files.set(f.path, { ...f, content: next, dirty: true, rev: f.rev + 1 }); touched.push(f.path); }
    }
  }
  // a topic's subtopic folder moves with it
  if (from.startsWith("Topics/")) {
    const oldDir = from.replace(/\.md$/, "") + "/", newDir = to.replace(/\.md$/, "") + "/";
    for (const f of [...files.values()]) {
      if (f.deleted || !f.path.startsWith(oldDir)) continue;
      const np = newDir + f.path.slice(oldDir.length);
      if (f.baseSha) files.set(f.path, { ...f, deleted: true, dirty: true, rev: f.rev + 1 }); else files.delete(f.path);
      files.set(np, { path: np, content: f.content, dirty: true, mtime: f.mtime, rev: 1 });
      touched.push(f.path, np);
    }
  }
  persist(touched);
  rebuild();
  local();
  return true;
}

export const folderOf = dirname;

// ── sync side ─────────────────────────────────────────────────

/** Files from the vault: set text and bookkeeping without marking them dirty. `content: null` removes. */
export function applyRemote(changes: { path: string; content: string | null; sha?: string; dirty?: boolean; base?: string }[]) {
  if (!changes.length) return;
  const now = Date.now();
  for (const c of changes) {
    if (c.content == null) { files.delete(c.path); continue; }
    const r = files.get(c.path);
    files.set(c.path, {
      path: c.path, content: c.content,
      base: c.base ?? c.content, baseSha: c.sha,
      dirty: c.dirty ?? false, mtime: r && r.content === c.content && !r.deleted ? r.mtime : now, rev: (r?.rev ?? 0) + 1,
    });
  }
  persist(changes.map((c) => c.path));
  rebuild();
}

/** After a push: these files now match the vault at `sha`, unless they changed again while it ran. */
export function settle(done: { path: string; rev: number; content: string | null; sha?: string }[]) {
  const touched: string[] = [];
  for (const d of done) {
    const r = files.get(d.path);
    if (!r) continue;
    if (d.content == null) {
      // a removal reached the vault
      if (r.deleted && r.rev === d.rev) files.delete(d.path);
      else files.set(d.path, { ...r, base: undefined, baseSha: undefined });
    } else if (r.rev === d.rev) {
      files.set(d.path, { ...r, base: d.content, baseSha: d.sha, dirty: false });
    } else {
      files.set(d.path, { ...r, base: d.content, baseSha: d.sha }); // edited meanwhile: stays dirty, merges from here
    }
    touched.push(d.path);
  }
  persist(touched);
  rebuild();
}

/** The same files with other text and nothing to sync: private notes decrypted or locked on this device. */
export function replaceTexts(changes: { path: string; content: string; base?: string }[]) {
  const touched: string[] = [];
  for (const c of changes) {
    const r = files.get(c.path);
    if (!r || r.deleted) continue;
    files.set(c.path, { ...r, content: c.content, base: c.base ?? r.base, rev: r.rev + 1 });
    touched.push(c.path);
  }
  if (!touched.length) return;
  persist(touched);
  rebuild();
}

/** Mark files dirty without changing them (a backup import, or a fresh empty vault to fill). */
export function markDirty(paths: string[]) {
  for (const p of paths) { const r = files.get(p); if (r) files.set(p, { ...r, dirty: true, rev: r.rev + 1 }); }
  persist(paths);
  local();
}

export const syncedRecords = () => [...files.values()].filter((r) => isSynced(r.path));
