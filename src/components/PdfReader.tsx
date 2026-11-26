/* The PDF reader (lazy; sheet { kind: "pdf", path: <the PDF's page>, page? }), full screen. pdf.js draws each
   page on a canvas with its text laid over it (pdf.js's text layer), so a passage can be selected and kept as
   a highlight on the page's saved link, its comment a link to the page (`[[PDFs/x.pdf#page=12|p. 12]]`).
   Highlights already made show marked on their page. Pages are drawn only near the screen (and let go when
   far, for the iPhone's memory). Where I was is kept per device (localStorage knowledgePath.pdfPlace). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { cleanSelection, pageLink, pageOf, pdfOf, rangesFor } from "../../shared/pdfs.ts";
import { parseHighlights } from "../../shared/vault.ts";
import { addHighlight } from "../state/actions";
import { loadPdf } from "../state/pdfs";
import { useIndex } from "../state/store";
import { showToast } from "../lib/toast";
import { useHeldSelection } from "../lib/selection";
import { IconClose, IconMinus, IconPlus, IconQuote } from "./Icons";

GlobalWorkerOptions.workerSrc = workerUrl;

const PLACE_KEY = "knowledgePath.pdfPlace";
type Place = { page: number; zoom: number };
function readPlace(pdf: string): Place | undefined {
  try { return (JSON.parse(localStorage.getItem(PLACE_KEY) ?? "{}") as Record<string, Place>)[pdf]; } catch { return undefined; }
}
function savePlace(pdf: string, p: Place) {
  try {
    const all = JSON.parse(localStorage.getItem(PLACE_KEY) ?? "{}") as Record<string, Place>;
    all[pdf] = p;
    localStorage.setItem(PLACE_KEY, JSON.stringify(all));
  } catch { /* full or blocked */ }
}

const ZOOMS = [0.6, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3];

export function PdfReader({ path, page, onClose }: { path: string; page?: number; onClose: () => void }) {
  const ix = useIndex();
  const d = ix.docs.get(path);
  const pdf = d ? pdfOf(d.fm) : undefined;
  const dlg = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ratio, setRatio] = useState(1.414); // height / width of page 1, for the pages not drawn yet
  const place = useMemo(() => (pdf ? readPlace(pdf) : undefined), [pdf]);
  const [zoom, setZoom] = useState(place?.zoom ?? 1);
  const [cur, setCur] = useState(page ?? place?.page ?? 1);
  const [width, setWidth] = useState(0);

  useEffect(() => { dlg.current?.showModal(); }, []);
  const close = () => dlg.current?.close();

  // load: from this device, else from the vault
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    let task: ReturnType<typeof getDocument> | null = null;
    (async () => {
      try {
        const blob = await loadPdf(pdf);
        const data = new Uint8Array(await blob.arrayBuffer());
        if (!alive) return;
        task = getDocument({ data });
        const loaded = await task.promise;
        if (!alive) return;
        const p1 = await loaded.getPage(1);
        const v = p1.getViewport({ scale: 1 });
        setRatio(v.height / v.width);
        setDoc(loaded);
      } catch (e) {
        if (alive) setErr((e as Error).message || "Couldn't open the PDF");
      }
    })();
    return () => { alive = false; void task?.destroy(); };
  }, [pdf]);

  // the width a page is drawn at: the reading column (fit to width) × zoom
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(el.clientWidth - 24, 900)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pageW = Math.max(200, Math.round(width * zoom));

  // go to the page I was on (or was asked for) once the pages are laid out
  const jumped = useRef(false);
  useEffect(() => {
    if (!doc || !width || jumped.current) return;
    jumped.current = true;
    const target = Math.min(Math.max(1, page ?? place?.page ?? 1), doc.numPages);
    requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-page="${target}"]`)?.scrollIntoView({ block: "start" }));
  }, [doc, width, page, place]);

  // which page is at the top, as I scroll
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const top = el.getBoundingClientRect().top + 80;
        let n = 1;
        for (const p of el.querySelectorAll<HTMLElement>("[data-page]")) { if (p.getBoundingClientRect().top <= top) n = Number(p.dataset.page); else break; }
        setCur(n);
      });
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => { el.removeEventListener("scroll", on); if (raf) cancelAnimationFrame(raf); };
  }, [doc]);
  useEffect(() => { if (pdf && doc) savePlace(pdf, { page: cur, zoom }); }, [pdf, doc, cur, zoom]);

  // zoom: keep the page I'm on in view
  const changeZoom = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? 3 : i) + dir))];
    if (next === zoom) return;
    const at = cur;
    setZoom(next);
    requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-page="${at}"]`)?.scrollIntoView({ block: "start" }));
  };

  // selecting a passage offers Highlight (held for a tap: src/lib/selection.ts)
  const curRef = useRef(cur);
  curRef.current = cur;
  const { sel, buttonProps } = useHeldSelection(scroller, (s) => {
    const at = s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement;
    const n = Number(at?.closest<HTMLElement>("[data-page]")?.dataset.page ?? curRef.current);
    const text = cleanSelection(s.toString());
    return text ? { text, page: n } : null;
  });
  const keep = (v: { text: string; page: number }) => {
    if (!pdf) return;
    addHighlight(path, v.text, pageLink(pdf, v.page));
    showToast(`Highlighted on p. ${v.page}`);
  };

  // highlights by page, to mark them
  const byPage = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const h of parseHighlights(d?.body ?? "")) {
      const n = pageOf(h.comment);
      if (n) m.set(n, [...(m.get(n) ?? []), h.quote]);
    }
    return m;
  }, [d?.body]);

  const pages = doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [];
  return (
    <dialog ref={dlg} className="cook-dlg pdf-dlg" aria-label={`Reading ${d?.title ?? "a PDF"}`} onClose={onClose}>
      <header className="cook-bar pdf-bar">
        <button type="button" className="icon-btn" onClick={close} aria-label="Close the reader"><IconClose /></button>
        <h2 className="cook-title" dir="auto">{d?.title ?? "PDF"}</h2>
        {doc && <span className="muted small pdf-pageno" aria-live="polite">{cur} / {doc.numPages}</span>}
        <button type="button" className="icon-btn subtle" onClick={() => changeZoom(-1)} disabled={zoom <= ZOOMS[0]} aria-label="Smaller"><IconMinus /></button>
        <button type="button" className="icon-btn subtle" onClick={() => changeZoom(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="Bigger"><IconPlus /></button>
      </header>
      <div className="pdf-scroll" ref={scroller}>
        {!pdf && <p className="pdf-msg muted">This page has no PDF.</p>}
        {pdf && !doc && !err && <p className="pdf-msg muted">Opening… (the first time on this device it's downloaded from the vault)</p>}
        {err && <p className="pdf-msg">Couldn't open it: {err}</p>}
        {doc && width > 0 && pages.map((n) => (
          <PdfPage key={n} doc={doc} n={n} width={pageW} ratio={ratio} root={scroller} marks={byPage.get(n)} />
        ))}
      </div>
      {sel && (
        <button type="button" className="btn primary hl-float pdf-hl-btn" {...buttonProps(keep)}>
          <IconQuote /> Highlight
        </button>
      )}
    </dialog>
  );
}

/** Canvas pixels allowed per page (iOS Safari gives up on big canvases). */
const MAX_PIXELS = 12_000_000;

function PdfPage({ doc, n, width, ratio, root, marks }: { doc: PDFDocumentProxy; n: number; width: number; ratio: number; root: React.RefObject<HTMLDivElement | null>; marks?: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [h, setH] = useState(Math.round(width * ratio));
  const textDivs = useRef<HTMLElement[]>([]);
  const texts = useRef<string[]>([]);

  useEffect(() => {
    const el = box.current!;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root: root.current, rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  // mark the highlights on the page: just the quoted characters (a <mark> inside the text layer's span)
  const mark = useCallback(() => {
    const divs = textDivs.current;
    divs.forEach((t, i) => { if (t.querySelector("mark")) t.textContent = texts.current[i]; });
    for (const q of marks ?? []) for (const { i, from, to } of rangesFor(texts.current, q)) {
      const t = divs[i];
      if (!t || t.querySelector("mark")) continue; // two highlights in one piece: the first is marked
      const s = texts.current[i];
      const m = document.createElement("mark");
      m.className = "pdf-hl";
      m.textContent = s.slice(from, to);
      t.replaceChildren(s.slice(0, from), m, s.slice(to));
    }
  }, [marks]);

  useEffect(() => {
    if (!near) return;
    const el = box.current!;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    let layer: TextLayer | null = null;
    (async () => {
      const page = await doc.getPage(n);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const vp = page.getViewport({ scale });
      setH(Math.round(vp.height));
      const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (vp.width * vp.height)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      canvas.className = "pdf-canvas";
      const rt = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = rt;
      try { await rt.promise; } catch { return; }
      if (cancelled) return;
      const text = document.createElement("div");
      text.className = "textLayer";
      el.style.setProperty("--total-scale-factor", String(scale));
      el.replaceChildren(canvas, text);
      layer = new TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: vp });
      try { await layer.render(); } catch { return; }
      if (cancelled) return;
      textDivs.current = layer.textDivs;
      texts.current = layer.textContentItemsStr;
      mark();
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
      textDivs.current = [];
      texts.current = [];
      el.replaceChildren(); // let the canvas go
    };
  }, [near, doc, n, width]); // `mark` runs by itself below when the highlights change

  useEffect(() => { mark(); }, [mark]);

  return (
    <div className="pdf-page-wrap" data-page={n} style={{ width, height: h }}>
      <div ref={box} className="pdf-page" style={{ width, height: h }} />
      <span className="pdf-page-n" aria-hidden="true">{n}</span>
    </div>
  );
}
