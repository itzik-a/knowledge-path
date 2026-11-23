/* Drawing a sketch, full screen: pen (its width follows the Apple Pencil's pressure), highlighter and
   eraser (it takes whole strokes), four ink colours, three sizes, undo and redo.

   The Pencil draws and fingers scroll and pinch, so a resting palm never marks the page. Until this device
   has seen a Pencil, fingers draw too (on the iPhone); the hand button switches that by hand. The mouse
   or trackpad draws on the Mac. The page is 1000 units wide whatever the screen, and gets longer as you
   draw near the bottom; it's saved trimmed to the drawing. */
import { getStroke, type StrokeOptions } from "perfect-freehand";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  HIGHLIGHT, HIGHLIGHT_OPACITY, INK, layered, outlineToPath, parseSketch, PEN_COLORS, SKETCH_WIDTH, trimmedHeight, type Stroke,
} from "../../shared/sketch.ts";
import { confirmAsk } from "../lib/confirm";
import { deleteSketch, saveSketch } from "../state/sketches";
import { readFile } from "../state/store";
import { IconEraser, IconHand, IconHighlighter, IconRedo, IconSketch, IconTrash, IconUndo } from "./Icons";

type Tool = "pen" | "highlighter" | "eraser";
const SIZES: Record<Exclude<Tool, "eraser">, number[]> = { pen: [3.5, 6, 11], highlighter: [20, 30, 44] };
const COLOR_NAMES: Record<string, string> = { [INK]: "Ink", "#2A78D6": "Blue", "#E34948": "Red", "#1BAF7A": "Green" };
const ERASE_R = 10;
const GROW_AT = 260, GROW_BY = 700;
const PENCIL_KEY = "knowledgePath.pencil";

function strokeOptions(tool: Exclude<Tool, "eraser">, size: number, pen: boolean, last: boolean): StrokeOptions {
  return tool === "highlighter"
    ? { size, thinning: 0, smoothing: 0.6, streamline: 0.6, simulatePressure: false, last }
    : { size, thinning: pen ? 0.65 : 0.5, smoothing: 0.55, streamline: pen ? 0.35 : 0.5, simulatePressure: !pen, last, start: { cap: true }, end: { cap: true } };
}

interface Live { id: number; tool: Exclude<Tool, "eraser">; size: number; color: string; pen: boolean; points: number[][] }

export function SketchSheet({ path, note, onClose }: { path?: string; note?: string; onClose: () => void }) {
  const initial = useMemo(() => (path ? parseSketch(readFile(path) ?? "") : null), [path]);
  const [strokes, setStrokes] = useState<Stroke[]>(() => initial?.strokes ?? []);
  const hist = useRef<{ undo: Stroke[][]; redo: Stroke[][] }>({ undo: [], redo: [] });
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(INK);
  const [sizeIx, setSizeIx] = useState(1);
  const [finger, setFinger] = useState(() => localStorage.getItem(PENCIL_KEY) !== "1");
  const [height, setHeight] = useState(() => (initial?.height ?? 0) + GROW_BY);
  const [scale, setScale] = useState(1);
  const [liveD, setLiveD] = useState("");
  const dirty = useRef(false);

  const dlg = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const surface = useRef<SVGSVGElement>(null);
  const live = useRef<Live | null>(null);
  const erasing = useRef<{ id: number; before: Stroke[]; now: Stroke[] } | null>(null);
  const frame = useRef(0);
  const fingerRef = useRef(finger);
  fingerRef.current = finger;

  // ── the dialog ──
  useEffect(() => {
    dlg.current?.showModal();
    (document.activeElement as HTMLElement | null)?.blur(); // no focus ring on Cancel at the start
    document.documentElement.classList.add("sheet-open");
    return () => { document.documentElement.classList.remove("sheet-open"); cancelAnimationFrame(frame.current); };
  }, []);

  // ── page size: 1000 units across the width; at least a screenful tall ──
  useLayoutEffect(() => {
    const el = scroller.current!;
    const fit = () => {
      const s = (surface.current?.getBoundingClientRect().width ?? 0) / SKETCH_WIDTH;
      if (s > 0) {
        setScale(s);
        setHeight((h) => Math.max(h, Math.ceil(el.clientHeight / s) - 80));
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── the Pencil never scrolls, zooms or brings up the magnifier; fingers do, unless they draw ──
  useEffect(() => {
    const el = surface.current!;
    const stop = (e: TouchEvent) => {
      const stylus = [...e.changedTouches].some((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
      if (stylus || (fingerRef.current && e.touches.length === 1)) e.preventDefault();
    };
    el.addEventListener("touchstart", stop, { passive: false });
    el.addEventListener("touchmove", stop, { passive: false });
    return () => { el.removeEventListener("touchstart", stop); el.removeEventListener("touchmove", stop); };
  }, []);

  function change(next: Stroke[], before = strokes) {
    hist.current.undo.push(before);
    if (hist.current.undo.length > 200) hist.current.undo.shift();
    hist.current.redo = [];
    dirty.current = true;
    setStrokes(next);
  }
  function undo() {
    const prev = hist.current.undo.pop();
    if (!prev) return;
    hist.current.redo.push(strokes);
    dirty.current = true;
    setStrokes(prev);
  }
  function redo() {
    const next = hist.current.redo.pop();
    if (!next) return;
    hist.current.undo.push(strokes);
    dirty.current = true;
    setStrokes(next);
  }

  // ── pointer input ──
  const at = (e: { clientX: number; clientY: number }) => {
    const r = surface.current!.getBoundingClientRect();
    const k = SKETCH_WIDTH / r.width;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  };
  const growIfNear = (y: number) => { if (y > height - GROW_AT) setHeight((h) => (y > h - GROW_AT ? h + GROW_BY : h)); };

  const paths = useMemo(() => new Map<Stroke, Path2D>(), []);
  const hitCtx = useMemo(() => document.createElement("canvas").getContext("2d")!, []);
  function hits(s: Stroke, x: number, y: number) {
    let p = paths.get(s);
    if (!p) { p = new Path2D(s.d); paths.set(s, p); }
    hitCtx.lineWidth = ERASE_R * 2;
    return hitCtx.isPointInPath(p, x, y) || hitCtx.isPointInStroke(p, x, y);
  }
  function eraseAt(x: number, y: number) {
    const e = erasing.current!;
    const keep = e.now.filter((s) => !hits(s, x, y));
    if (keep.length !== e.now.length) { e.now = keep; setStrokes(keep); }
  }

  function renderLive() {
    frame.current = 0;
    const l = live.current;
    if (!l) return;
    setLiveD(outlineToPath(getStroke(l.points, strokeOptions(l.tool, l.size, l.pen, false))));
  }

  function onDown(e: RPointerEvent<SVGSVGElement>) {
    if (live.current || erasing.current) return;
    if (e.pointerType === "pen" && localStorage.getItem(PENCIL_KEY) !== "1") { localStorage.setItem(PENCIL_KEY, "1"); setFinger(false); }
    if (e.pointerType === "touch" && !finger) return; // fingers scroll
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    surface.current!.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    if (tool === "eraser") {
      erasing.current = { id: e.pointerId, before: strokes, now: strokes };
      eraseAt(x, y);
      return;
    }
    const pen = e.pointerType === "pen";
    live.current = {
      id: e.pointerId, tool, pen, points: [[x, y, pen ? Math.max(0.05, e.pressure) : 0.5]],
      size: SIZES[tool][sizeIx], color: tool === "highlighter" ? HIGHLIGHT : color,
    };
    renderLive();
  }

  function onMove(e: RPointerEvent<SVGSVGElement>) {
    const l = live.current, er = erasing.current;
    if (!(l && l.id === e.pointerId) && !(er && er.id === e.pointerId)) return;
    const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e.nativeEvent]) {
      const [x, y] = at(ev);
      if (er) { eraseAt(x, y); continue; }
      l!.points.push([x, y, l!.pen ? Math.max(0.05, ev.pressure) : 0.5]);
      growIfNear(y);
    }
    if (l && !frame.current) frame.current = requestAnimationFrame(renderLive);
  }

  function onUp(e: RPointerEvent<SVGSVGElement>) {
    const er = erasing.current;
    if (er && er.id === e.pointerId) {
      erasing.current = null;
      if (er.now !== er.before) change(er.now, er.before);
      return;
    }
    const l = live.current;
    if (!l || l.id !== e.pointerId) return;
    live.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setLiveD("");
    if (e.type === "pointercancel" && l.points.length < 3) return;
    const d = outlineToPath(getStroke(l.points, strokeOptions(l.tool, l.size, l.pen, true)));
    if (!d) return;
    change([...strokes, l.tool === "highlighter" ? { d, fill: l.color, opacity: HIGHLIGHT_OPACITY } : { d, fill: l.color }]);
  }

  // ── leaving ──
  async function cancel() {
    if (dirty.current && !(await confirmAsk({ title: "Discard this drawing?", body: "What you drew since opening it isn't saved.", ok: "Discard" }))) return;
    dlg.current?.close();
  }
  async function done() {
    if (!dirty.current) { dlg.current?.close(); return; }
    if (!strokes.length) {
      if (path && (await confirmAsk({ title: "Delete this sketch?", body: "The page is empty. Delete the sketch and take it out of the note?", ok: "Delete" }))) {
        deleteSketch(path, note);
        dlg.current?.close();
      } else if (!path) dlg.current?.close();
      return;
    }
    saveSketch({ width: SKETCH_WIDTH, height: trimmedHeight(strokes), strokes }, { path, note });
    dlg.current?.close();
  }
  async function remove() {
    if (!path || !(await confirmAsk({ title: "Delete this sketch?", body: "It's taken out of the note and deleted from the vault. You can undo for a few seconds after.", ok: "Delete" }))) return;
    deleteSketch(path, note);
    dlg.current?.close();
  }

  // ⌘Z / ⇧⌘Z on the Mac
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const drawn = useMemo(() => layered(strokes).map((s, i) => (
    <path key={i} d={s.d} fill={s.fill === INK ? "currentColor" : s.fill} fillOpacity={s.opacity} />
  )), [strokes]);
  const l = live.current;
  const notOurs = !!path && !initial;

  return (
    <dialog ref={dlg} className="sketch-dlg" aria-label={path ? "Sketch" : "New sketch"} onClose={onClose}
      onCancel={(e) => { e.preventDefault(); void cancel(); }}>
      <header className="sketch-bar">
        <button type="button" className="btn ghost sm" onClick={() => void cancel()}>Cancel</button>
        <h2 className="sketch-title"><IconSketch width={18} height={18} /> {path ? "Sketch" : "New sketch"}</h2>
        <button type="button" className="btn primary sm" onClick={() => void done()} disabled={notOurs}>Done</button>
      </header>

      {notOurs ? (
        <div className="card empty sketch-note"><p className="muted">This drawing wasn't made in Knowledge Path, so it can only be shown, not drawn on.</p></div>
      ) : (
        <>
          <div className="sketch-tools" role="toolbar" aria-label="Drawing tools">
            <div className="tool-group" role="group" aria-label="Tool">
              {([["pen", "Pen", IconSketch], ["highlighter", "Highlighter", IconHighlighter], ["eraser", "Eraser", IconEraser]] as const).map(([t, label, Icon]) => (
                <button key={t} type="button" className="tool" aria-pressed={tool === t} aria-label={label} title={label} onClick={() => setTool(t)}><Icon /></button>
              ))}
            </div>
            {/* every group stays put (dimmed when it doesn't apply), so the page never shifts under the Pencil */}
            <div className="tool-group" role="group" aria-label="Colour">
                {PEN_COLORS.map((c) => (
                  <button key={c} type="button" className="tool" aria-pressed={tool === "pen" && color === c} aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]}
                    disabled={tool !== "pen"} onClick={() => setColor(c)}>
                    <span className={`ink-dot${c === INK ? " ink" : ""}`} style={c === INK ? undefined : { background: c }} />
                  </button>
                ))}
            </div>
            <div className="tool-group" role="group" aria-label="Size">
                {[0, 1, 2].map((i) => (
                  <button key={i} type="button" className="tool" aria-pressed={tool !== "eraser" && sizeIx === i} aria-label={["Fine", "Medium", "Thick"][i]} title={["Fine", "Medium", "Thick"][i]}
                    disabled={tool === "eraser"} onClick={() => setSizeIx(i)}>
                    <span className={`size-dot${tool === "highlighter" ? " marker" : ""}`}
                      style={tool === "highlighter" ? { height: 5 + i * 4 } : { width: 4 + i * 4, height: 4 + i * 4 }} />
                  </button>
                ))}
            </div>
            <div className="tool-group" role="group" aria-label="History">
              <button type="button" className="tool" onClick={undo} disabled={!hist.current.undo.length} aria-label="Undo" title="Undo (⌘Z)"><IconUndo /></button>
              <button type="button" className="tool" onClick={redo} disabled={!hist.current.redo.length} aria-label="Redo" title="Redo (⇧⌘Z)"><IconRedo /></button>
            </div>
            <div className="tool-group" role="group" aria-label="Options">
              <button type="button" className="tool" aria-pressed={finger} onClick={() => setFinger((f) => !f)}
                aria-label="Draw with a finger" title={finger ? "Fingers draw (tap so only the Pencil draws)" : "Only the Pencil draws; fingers scroll"}><IconHand /></button>
              {path && <button type="button" className="tool danger" onClick={() => void remove()} aria-label="Delete sketch" title="Delete sketch"><IconTrash /></button>}
            </div>
          </div>

          <div className="sketch-scroll" ref={scroller}>
            <svg ref={surface} className={`sketch-surface${finger ? " finger" : ""}`} viewBox={`0 0 ${SKETCH_WIDTH} ${height}`}
              style={{ height: height * scale }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              {drawn}
              {l && liveD && <path d={liveD} fill={l.color === INK ? "currentColor" : l.color} fillOpacity={l.tool === "highlighter" ? HIGHLIGHT_OPACITY : undefined} />}
            </svg>
            <div className="sketch-foot">
              <button type="button" className="btn ghost sm" onClick={() => setHeight((h) => h + GROW_BY)}>More room</button>
              <span className="muted small">{finger ? "Fingers draw. Tap the hand so only the Pencil does." : "The Pencil draws; fingers scroll."}</span>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
