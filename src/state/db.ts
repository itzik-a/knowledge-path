/* The vault on this device: IndexedDB "knowledgePath", one record per file, plus a few meta values
   (sync state). localStorage only holds small per-device settings. */
import { openDB, type IDBPDatabase } from "idb";

export interface FileRec {
  path: string;
  content: string;
  /** The text as last synced (or as seeded): the common ancestor for a three-way merge. */
  base?: string;
  /** The blob sha of `base` in the vault repo; missing until the file has been synced once. */
  baseSha?: string;
  /** Changed here since the last sync. */
  dirty: boolean;
  /** Removed here; kept until the removal reaches the vault. */
  deleted?: boolean;
  /** Last change here, or when it arrived from the vault. */
  mtime: number;
  /** Bumped on every local change, so a sync can tell an edit made while it ran. */
  rev: number;
  /** The text of a push this device hasn't heard back from (plain text, before encryption). If a later sync
      finds exactly this in the vault, that push landed: it's my own text, not an edit from somewhere else. */
  sent?: string;
}

/** A file the text sync doesn't carry (a PDF), kept here as it is. */
export interface BlobRec {
  path: string;
  blob: Blob;
  size: number;
  /** in the vault already (sent from here, or downloaded from there) */
  uploaded: boolean;
  /** too big for the vault: only on this device */
  local?: boolean;
  added: number;
}

let dbp: Promise<IDBPDatabase> | null = null;
const db = () => (dbp ??= openDB("knowledgePath", 2, {
  upgrade(d, old) {
    if (old < 1) {
      d.createObjectStore("files", { keyPath: "path" });
      d.createObjectStore("meta");
    }
    if (old < 2) d.createObjectStore("blobs", { keyPath: "path" });
  },
}));

export async function getBlob(path: string): Promise<BlobRec | undefined> {
  return (await db()).get("blobs", path) as Promise<BlobRec | undefined>;
}
export async function putBlob(r: BlobRec) {
  await (await db()).put("blobs", r);
}
export async function deleteBlob(path: string) {
  await (await db()).delete("blobs", path);
}
/** Every kept file's record, without reading the files themselves into memory more than needed. */
export async function allBlobs(): Promise<BlobRec[]> {
  return (await db()).getAll("blobs") as Promise<BlobRec[]>;
}

export async function loadAll(): Promise<FileRec[]> {
  return (await db()).getAll("files");
}

export async function saveFiles(put: FileRec[], del: string[]) {
  if (!put.length && !del.length) return;
  const tx = (await db()).transaction("files", "readwrite");
  for (const r of put) void tx.store.put(r);
  for (const p of del) void tx.store.delete(p);
  await tx.done;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get("meta", key) as Promise<T | undefined>;
}

export async function setMeta(key: string, value: unknown) {
  await (await db()).put("meta", value, key);
}

export async function clearAll() {
  const d = await db();
  await d.clear("files");
  await d.clear("meta");
  await d.clear("blobs");
}
