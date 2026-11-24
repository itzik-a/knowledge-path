/* An EPUB of an rsarchive.org book, made on GitHub on request and never kept in the vault
   (enricher/epubs.ts): ask for it, see it being made, save it, and it's removed from GitHub. */
import { useEffect, useState } from "react";
import { epubRequestFor, forgetEpub, requestEpub, type EpubReq } from "../state/actions";
import { useVault } from "../state/store";
import { fetchVaultFile } from "../state/sync";
import { showToast } from "../lib/toast";
import { IconDownload } from "./Icons";

export function useEpubRequest(url?: string): EpubReq | undefined {
  useVault();
  return url ? epubRequestFor(url) : undefined;
}

/** "EPUB": ask for one. Hidden while one is asked for: EpubStatus shows it then (cancel, retry, save). */
export function EpubButton({ url, title, className = "btn ghost sm", label = "EPUB" }: { url: string; title?: string; className?: string; label?: string }) {
  const req = useEpubRequest(url);
  if (req) return null;
  return (
    <button type="button" className={className} onClick={() => requestEpub(url, title)} title="Made on GitHub in a few minutes; not kept in the vault">
      <IconDownload /> {label}
    </button>
  );
}

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Where an asked-for EPUB is: being made, ready to save, or failed. Nothing when none was asked for. */
export function EpubStatus({ url }: { url: string }) {
  const req = useEpubRequest(url);
  const ready = req?.ready;
  const [file, setFile] = useState<File | null>(null);
  const [fetchError, setFetchError] = useState("");

  // Fetch it as soon as it's ready, so Save hands it over within the tap (iOS wants that for share and download).
  useEffect(() => {
    setFile(null);
    setFetchError("");
    if (!ready) return;
    let live = true;
    fetchVaultFile(ready.file, ready.branch)
      .then((b) => { if (live) setFile(new File([b], ready.file, { type: "application/epub+zip" })); })
      .catch((e: Error) => { if (live) setFetchError(e.message); });
    return () => { live = false; };
  }, [ready?.branch, ready?.file]);

  if (!req) return null;

  const save = async () => {
    if (!file) return;
    const touch = matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: ready?.title });
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // kept: try again
        throw e;
      }
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    }
    forgetEpub(req);
    showToast("Saved. It's removed from GitHub too");
  };

  if (req.error || fetchError) {
    return (
      <div className="epub-status" role="status">
        <span className="grow"><b>Couldn't make the EPUB.</b> <span className="muted">{req.error || fetchError}</span></span>
        <button type="button" className="btn primary sm" onClick={() => requestEpub(req.url, req.title)}>Try again</button>
        <button type="button" className="btn ghost sm" onClick={() => forgetEpub(req)}>Cancel</button>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="epub-status" role="status">
        <span className="grow"><b>Making the EPUB</b> <span className="muted">on GitHub, a page a second: it's here in a few minutes. It isn't kept in the vault.</span></span>
        <button type="button" className="btn ghost sm" onClick={() => forgetEpub(req)}>Cancel</button>
      </div>
    );
  }
  return (
    <div className="epub-status" role="status">
      <span className="grow">
        <b dir="auto">{ready.title}</b> <span className="muted">EPUB · {ready.chapters} chapter{ready.chapters === 1 ? "" : "s"} · {mb(ready.size)}{req.note ? ` · ${req.note}` : ""}</span>
      </span>
      <button type="button" className="btn primary sm" disabled={!file} onClick={() => void save()}><IconDownload /> {file ? "Save EPUB" : "Getting it…"}</button>
      <button type="button" className="btn ghost sm" onClick={() => forgetEpub(req)}>Discard</button>
    </div>
  );
}
