/* PDFs (shared/pdfs.ts): the files themselves live outside the text sync. Added here, a PDF is kept in
   IndexedDB ("blobs") and, when it's at most PDF_LIMIT, put in the vault with its own commit (the contents
   API); a bigger one stays on this device (`pdfLocal: true`). Opened on another device, it's downloaded
   from the vault once and kept. Uploads that couldn't go (offline, not connected yet) go on the next try:
   at start, after each sync, and when the browser is back online. */
import { useEffect, useState } from "react";
import type { Status } from "../../shared/vault.ts";
import { isPdfPath, pdfOf, pdfLink, pdfPathFor, PDF_LIMIT } from "../../shared/pdfs.ts";
import { showToast } from "../lib/toast";
import { createResource, patchResource } from "./actions";
import { allBlobs, deleteBlob, getBlob, putBlob, type BlobRec } from "./db";
import { getIndex } from "./store";
import { deleteVaultFile, fetchVaultFile, getConfig, onSynced, otherFiles, putVaultFile } from "./sync";

export const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`);

/** Add a PDF: keep it here, make its page (a saved link in Resources/), and send it to the vault if it fits. */
export async function addPdf(file: File, o: { topics?: string[]; status?: Status } = {}): Promise<string> {
  const title = file.name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim() || "Document";
  const kept = new Set((await allBlobs()).map((b) => b.path.toLowerCase()));
  const other = otherFiles();
  const path = pdfPathFor(title, (p) => kept.has(p.toLowerCase()) || p in other);
  const local = file.size > PDF_LIMIT;
  await putBlob({ path, blob: file, size: file.size, uploaded: false, local, added: Date.now() });
  const res = createResource({ title, type: "paper", topics: o.topics ?? [], status: o.status });
  patchResource(res, { pdf: pdfLink(path), pdfSize: file.size, pdfLocal: local || undefined });
  if (local) showToast(`${mb(file.size)} is more than the vault takes (${mb(PDF_LIMIT)}): it's only on this device`);
  else void uploadPending();
  return res;
}

let uploading: Promise<void> | null = null;

/** Send every PDF added here that isn't in the vault yet. */
export function uploadPending(): Promise<void> {
  if (uploading) return uploading;
  uploading = (async () => {
    try {
      if (!getConfig()) return;
      for (const b of await allBlobs()) {
        if (b.uploaded || b.local || !isPdfPath(b.path)) continue;
        if (!referenced(b.path)) continue; // its page was deleted before it went
        try {
          await putVaultFile(b.path, b.blob, `Add ${b.path}`);
          await putBlob({ ...b, uploaded: true });
          notify();
        } catch (e) {
          showToast(`Couldn't send ${b.path.split("/").pop()} to the vault: ${(e as Error).message}. It's kept here and tried again later.`);
          break;
        }
      }
    } finally {
      uploading = null;
    }
  })();
  return uploading;
}

/** Does any page in the vault point at this PDF? */
const referenced = (path: string) => [...getIndex().docs.values()].some((d) => pdfOf(d.fm) === path);

/** The PDF's bytes: kept here, or downloaded from the vault (and kept). */
export async function loadPdf(path: string): Promise<Blob> {
  const have = await getBlob(path);
  if (have) return have.blob;
  const blob = await fetchVaultFile(path);
  await putBlob({ path, blob, size: blob.size, uploaded: true, added: Date.now() });
  notify();
  return blob;
}

/** Take a PDF away, here and in the vault. Returns how to put it back (from memory, while the app is open). */
export async function removePdf(path: string): Promise<() => void> {
  const rec = await getBlob(path);
  await deleteBlob(path);
  notify();
  const inVault = !!rec?.uploaded || path in otherFiles();
  if (inVault) void deleteVaultFile(path, `Remove ${path}`).catch(() => {});
  return () => {
    if (!rec) return;
    void putBlob({ ...rec, uploaded: false }).then(() => { notify(); void uploadPending(); });
  };
}

/** PDFs in the vault without a page here (added in Obsidian, say): give each a saved link. */
export function unlinkedPdfs(): string[] {
  const used = new Set([...getIndex().docs.values()].map((d) => pdfOf(d.fm)).filter(Boolean));
  return Object.keys(otherFiles()).filter((p) => isPdfPath(p) && !used.has(p)).sort();
}

export function linkPdf(path: string): string {
  const title = path.split("/").pop()!.replace(/\.pdf$/i, "");
  const res = createResource({ title, type: "paper", topics: [] });
  patchResource(res, { pdf: pdfLink(path) });
  return res;
}

// ── what this device has, for the page's status line ──────────
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export type PdfState = { kind: "loading" } | { kind: "here"; rec: BlobRec } | { kind: "vault" } | { kind: "missing" };

/** Whether this PDF is on this device, in the vault, or neither (too big, added on another device). */
export function usePdfState(path: string | undefined): PdfState {
  const [s, setS] = useState<PdfState>({ kind: "loading" });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const look = () => void getBlob(path).then((rec) => {
      if (!alive) return;
      setS(rec ? { kind: "here", rec } : path in otherFiles() ? { kind: "vault" } : { kind: "missing" });
    });
    look();
    listeners.add(look);
    const off = onSynced(look);
    return () => { alive = false; listeners.delete(look); off(); };
  }, [path]);
  return s;
}

export function startPdfs() {
  void uploadPending();
  onSynced(() => void uploadPending());
  window.addEventListener("online", () => void uploadPending());
}
