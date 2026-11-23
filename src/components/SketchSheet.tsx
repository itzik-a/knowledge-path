/* Drawing a sketch, full screen: pen (its width follows the Apple Pencil's pressure), highlighter,
   eraser (it takes whole strokes), lasso (draw a loop around strokes, then drag them somewhere else, or
   delete them), four ink colours, three sizes, undo and redo.

   The Pencil draws and fingers scroll and pinch, so a resting palm never marks the page. Until this device
   has seen a Pencil, fingers draw too (on the iPhone); the hand button switches that by hand. The mouse
   or trackpad draws on the Mac. The page is 1000 units wide whatever the screen, and gets longer as you
   draw near the bottom; it's saved trimmed to the drawing.

   Speed: the Pencil reports ~240 points a second. Points closer than MIN_STEP to the last one are dropped
   and its pressure is smoothed (raw, both make wobbly outlines and heavy strokes). The stroke being drawn,
   the lasso loop and a dragged selection are drawn straight into the SVG, once per frame, without
   re-rendering React; the eraser tests only strokes whose box is near the pen, once per frame. */
import { getStroke, type StrokeOptions } from "perfect-freehand";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  boundsOf, HIGHLIGHT, HIGHLIGHT_OPACITY, INK, inLasso, layered, moveStroke, outlineToPath, parseSketch, PEN_COLORS, SKETCH_WIDTH,
  trimmedHeight, type Stroke,
} from "../../shared/sketch.ts";
import { confirmAsk } from "../lib/confirm";
import { deleteSketch, saveSketch } from "../state/sketches";
import { readFile } from "../state/store";
import { IconEraser, IconHand, IconHighlighter, IconLasso, IconRedo, IconSketch, IconTrash, IconUndo } from "./Icons";

type Tool = "pen" | "highlighter" | "eraser" | "lasso";
type InkTool = "pen" | "highlighter";
const SIZES: Record<InkTool, number[]> = { pen: [3.5, 6, 11], highlighter: [20, 30, 44] };
const COLOR_NAMES: Record<string, string> = { [INK]: "Ink", "#2A78D6": "Blue", "#E34948": "Red", "#1BAF7A": "Green" };
const ERASE_R = 10;
/** the smallest step between two kept points of a stroke (page units; about 2.5 px on an iPad) */
const MIN_STEP = 3;
/** how much each new Pencil position counts (a running average: slow strokes move a pixel at a time,
    and the raw staircase shows as ripples along the edge); about 12 ms of lag at 240 readings a second */
const POSITION_EASE = 0.35;
/** how much each new Pencil pressure reading counts (the rest is the running average) */
const PRESSURE_EASE = 0.3;
/** room around a selection that still grabs it (in page units) */
const SEL_PAD = 14;
const GROW_AT = 260, GROW_BY = 700;
const PENCIL_KEY = "knowledgePath.pencil";

function strokeOptions(tool: InkTool, size: number, pen: boolean, last: boolean): StrokeOptions {
  return tool === "highlighter"
    ? { size, thinning: 0, smoothing: 0.6, streamline: 0.6, simulatePressure: false, last }
    : { size, thinning: pen ? 0.5 : 0.45, smoothing: 0.6, streamline: 0.5, simulatePressure: !pen, last, start: { cap: true }, end: { cap: true } };
}

interface Live { id: number; tool: InkTool; size: number; color: string; pen: boolean; points: number[][]; pressure: number; sx: number; sy: number }

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
  // the lasso: what's selected, and whether it's being dragged (the drag itself is drawn without React)
  const [sel, setSel] = useState<Set<Stroke>>(() => new Set());
  const [dragging, setDragging] = useState(false);
  const [overSel, setOverSel] = useState(false);
  const dirty = useRef(false);

  const dlg = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const surface = useRef<SVGSVGElement>(null);
  const live = useRef<Live | null>(null);
  const erasing = useRef<{ id: number; before: Stroke[]; now: Stroke[]; queue: number[][]; last?: number[] } | null>(null);
  const lassoing = useRef<{ id: number; points: number[][] } | null>(null);
  const moving = useRef<{ id: number; x: number; y: number; dx: number; dy: number } | null>(null);
  const frame = useRef(0);
  // drawn into directly, once per frame
  const livePath = useRef<SVGPathElement>(null);
  const loopEl = useRef<SVGPolygonElement>(null);
  const liftG = useRef<SVGGElement>(null);
  const rect = useRef<DOMRect | null>(null);
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
    setSel(new Set());
    setStrokes(prev);
  }
  function redo() {
    const next = hist.current.redo.pop();
    if (!next) return;
    hist.current.undo.push(strokes);
    dirty.current = true;
    setSel(new Set());
    setStrokes(next);
  }
  function pick(t: Tool) { setTool(t); setSel(new Set()); }

  const selected = useMemo(() => strokes.filter((s) => sel.has(s)), [strokes, sel]);
  const box = useMemo(() => boundsOf(selected), [selected]);
  const inBox = (x: number, y: number) => !!box && x >= box.x - SEL_PAD && x <= box.x + box.w + SEL_PAD && y >= box.y - SEL_PAD && y <= box.y + box.h + SEL_PAD;
  function deleteSelected() {
    if (!sel.size) return;
    change(strokes.filter((s) => !sel.has(s)));
    setSel(new Set());
  }

  // ── pointer input ──
  const at = (e: { clientX: number; clientY: number }) => {
    const r = rect.current ?? surface.current!.getBoundingClientRect();
    const k = SKETCH_WIDTH / r.width;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  };
  const growIfNear = (y: number) => { if (y > height - GROW_AT) setHeight((h) => (y > h - GROW_AT ? h + GROW_BY : h)); };

  const geo = useMemo(() => new Map<Stroke, { p: Path2D; x0: number; y0: number; x1: number; y1: number }>(), []);
  const hitCtx = useMemo(() => document.createElement("canvas").getContext("2d")!, []);
  function hits(s: Stroke, x: number, y: number) {
    let g = geo.get(s);
    if (!g) {
      const b = boundsOf([s]) ?? { x: 0, y: 0, w: 0, h: 0 };
      g = { p: new Path2D(s.d), x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
      geo.set(s, g);
    }
    if (x < g.x0 - ERASE_R || x > g.x1 + ERASE_R || y < g.y0 - ERASE_R || y > g.y1 + ERASE_R) return false;
    hitCtx.lineWidth = ERASE_R * 2;
    return hitCtx.isPointInPath(g.p, x, y) || hitCtx.isPointInStroke(g.p, x, y);
  }
  /** Erase along the readings that came in since the last frame (and the gaps between them). */
  function eraseQueued() {
    const e = erasing.current;
    if (!e || !e.queue.length) return;
    const pts: number[][] = [];
    for (const q of e.queue) {
      const from = e.last;
      if (from) {
        const n = Math.floor(Math.hypot(q[0] - from[0], q[1] - from[1]) / ERASE_R);
        for (let i = 1; i <= n; i++) pts.push([from[0] + ((q[0] - from[0]) * i) / (n + 1), from[1] + ((q[1] - from[1]) * i) / (n + 1)]);
      }
      pts.push(q);
      e.last = q;
    }
    e.queue = [];
    const keep = e.now.filter((s) => !pts.some(([x, y]) => hits(s, x, y)));
    if (keep.length !== e.now.length) { e.now = keep; setStrokes(keep); }
  }

  /** Add a reading to the stroke: dropped if it's too close to the last kept point; pressure smoothed. */
  function addPoint(l: Live, rx: number, ry: number, raw: number, final = false) {
    if (l.pen) l.pressure += (Math.max(0.05, raw) - l.pressure) * PRESSURE_EASE;
    // the running average of the position; the last point is where the pen actually lifted
    l.sx += (rx - l.sx) * POSITION_EASE;
    l.sy += (ry - l.sy) * POSITION_EASE;
    const x = final ? rx : l.sx, y = final ? ry : l.sy;
    const last = l.points[l.points.length - 1];
    if (last && !final && Math.hypot(x - last[0], y - last[1]) < MIN_STEP) return;
    if (last && final && x === last[0] && y === last[1]) return;
    l.points.push([x, y, l.pen ? l.pressure : 0.5]);
  }

  function renderLive() {
    frame.current = 0;
    const l = live.current, lz = lassoing.current, mv = moving.current;
    if (l) livePath.current?.setAttribute("d", outlineToPath(getStroke(l.points, strokeOptions(l.tool, l.size, l.pen, false))));
    if (lz) loopEl.current?.setAttribute("points", lz.points.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(" "));
    if (mv) liftG.current?.setAttribute("transform", `translate(${mv.dx} ${mv.dy})`);
    eraseQueued();
  }
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(renderLive); };

  function onDown(e: RPointerEvent<SVGSVGElement>) {
    if (live.current || erasing.current || lassoing.current || moving.current) return;
    if (e.pointerType === "pen" && localStorage.getItem(PENCIL_KEY) !== "1") { localStorage.setItem(PENCIL_KEY, "1"); setFinger(false); }
    if (e.pointerType === "touch" && !finger) return; // fingers scroll
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    surface.current!.setPointerCapture(e.pointerId);
    rect.current = surface.current!.getBoundingClientRect();
    const [x, y] = at(e);
    if (tool === "eraser") {
      erasing.current = { id: e.pointerId, before: strokes, now: strokes, queue: [[x, y]] };
      schedule();
      return;
    }
    if (tool === "lasso") {
      // on the selection: move it; anywhere else: a new loop
      if (sel.size && inBox(x, y)) { moving.current = { id: e.pointerId, x, y, dx: 0, dy: 0 }; return; }
      setSel(new Set());
      lassoing.current = { id: e.pointerId, points: [[x, y]] };
      loopEl.current?.setAttribute("points", "");
      return;
    }
    const pen = e.pointerType === "pen";
    const p0 = pen ? Math.max(0.05, e.pressure) : 0.5;
    const l: Live = { id: e.pointerId, tool, pen, points: [[x, y, p0]], pressure: p0, sx: x, sy: y, size: SIZES[tool][sizeIx], color: tool === "highlighter" ? HIGHLIGHT : color };
    live.current = l;
    const el = livePath.current;
    if (el) {
      el.setAttribute("fill", l.color === INK ? "currentColor" : l.color);
      if (l.tool === "highlighter") el.setAttribute("fill-opacity", String(HIGHLIGHT_OPACITY)); else el.removeAttribute("fill-opacity");
    }
    renderLive();
  }

  function onMove(e: RPointerEvent<SVGSVGElement>) {
    const l = live.current, er = erasing.current, lz = lassoing.current, mv = moving.current;
    const mine = (o: { id: number } | null) => !!o && o.id === e.pointerId;
    if (!mine(l) && !mine(er) && !mine(lz) && !mine(mv)) {
      // hovering (mouse, trackpad or a hovering Pencil): show that the selection can be grabbed
      if (tool === "lasso" && sel.size) { const [x, y] = at(e); const over = inBox(x, y); if (over !== overSel) setOverSel(over); }
      return;
    }
    if (mv && box) {
      const [x, y] = at(e);
      // keep the selection on the page
      mv.dx = Math.min(Math.max(x - mv.x, -box.x), SKETCH_WIDTH - box.x - box.w);
      mv.dy = Math.max(y - mv.y, -box.y);
      if (!dragging && (mv.dx || mv.dy)) setDragging(true);
      growIfNear(box.y + box.h + mv.dy);
      schedule();
      return;
    }
    const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e.nativeEvent]) {
      const [x, y] = at(ev);
      if (er) { er.queue.push([x, y]); continue; }
      if (lz) { const q = lz.points[lz.points.length - 1]; if (Math.hypot(x - q[0], y - q[1]) >= MIN_STEP * 2) lz.points.push([x, y]); continue; }
      addPoint(l!, x, y, ev.pressure);
    }
    if (l) growIfNear(l.points[l.points.length - 1][1]);
    schedule();
  }

  function onUp(e: RPointerEvent<SVGSVGElement>) {
    const lz = lassoing.current, mv = moving.current;
    rect.current = null;
    if (lz && lz.id === e.pointerId) {
      lassoing.current = null;
      loopEl.current?.setAttribute("points", "");
      setSel(new Set(strokes.filter((s) => inLasso(s.d, lz.points))));
      return;
    }
    if (mv && mv.id === e.pointerId) {
      moving.current = null;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      liftG.current?.setAttribute("transform", "");
      setDragging(false);
      if (!mv.dx && !mv.dy) return;
      const moved = new Set<Stroke>();
      change(strokes.map((s) => { if (!sel.has(s)) return s; const m = moveStroke(s, mv.dx, mv.dy); moved.add(m); return m; }));
      setSel(moved);
      return;
    }
    const er = erasing.current;
    if (er && er.id === e.pointerId) {
      eraseQueued();
      erasing.current = null;
      if (er.now !== er.before) change(er.now, er.before);
      return;
    }
    const l = live.current;
    if (!l || l.id !== e.pointerId) return;
    live.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (e.type === "pointercancel" && l.points.length < 3) { livePath.current?.setAttribute("d", ""); return; }
    const [x, y] = at(e);
    addPoint(l, x, y, e.pressure, true);
    const d = outlineToPath(getStroke(l.points, strokeOptions(l.tool, l.size, l.pen, true)));
    if (!d) { livePath.current?.setAttribute("d", ""); return; }
    // the live path is cleared once the finished stroke is on screen (no flicker in between)
    change([...strokes, l.tool === "highlighter" ? { d, fill: l.color, opacity: HIGHLIGHT_OPACITY } : { d, fill: l.color }]);
  }

  useLayoutEffect(() => { if (!live.current) livePath.current?.setAttribute("d", ""); }, [strokes]);

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

  // ⌘Z / ⇧⌘Z on the Mac; Delete removes the selection
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.key === "Backspace" || e.key === "Delete") && sel.size) { e.preventDefault(); deleteSelected(); return; }
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const ink = (s: Stroke, i: number) => <path key={i} d={s.d} fill={s.fill === INK ? "currentColor" : s.fill} fillOpacity={s.opacity} />;
  const drawn = useMemo(() => layered(strokes.filter((s) => !sel.has(s))).map(ink), [strokes, sel]);
  const lifted = useMemo(() => layered(selected).map(ink), [selected]);
  const notOurs = !!path && !initial;

  return (
    <dialog ref={dlg} className="sketch-dlg" aria-label={path ? "Sketch" : "New sketch"} onClose={onClose}
      onCancel={(e) => { e.preventDefault(); if (sel.size) setSel(new Set()); else void cancel(); }}>
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
              {([["pen", "Pen", IconSketch], ["highlighter", "Highlighter", IconHighlighter], ["eraser", "Eraser", IconEraser], ["lasso", "Lasso: select strokes to move", IconLasso]] as const).map(([t, label, Icon]) => (
                <button key={t} type="button" className="tool" aria-pressed={tool === t} aria-label={label.split(":")[0]} title={label} onClick={() => pick(t)}><Icon /></button>
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
                  <button key={i} type="button" className="tool" aria-pressed={(tool === "pen" || tool === "highlighter") && sizeIx === i} aria-label={["Fine", "Medium", "Thick"][i]} title={["Fine", "Medium", "Thick"][i]}
                    disabled={tool !== "pen" && tool !== "highlighter"} onClick={() => setSizeIx(i)}>
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
            <div className="sketch-page">
              <svg ref={surface} className={`sketch-surface${finger ? " finger" : ""}${tool === "lasso" ? " lasso" : ""}${overSel || moving.current ? " grab" : ""}`}
                viewBox={`0 0 ${SKETCH_WIDTH} ${height}`}
                style={{ height: height * scale }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
                {drawn}
                {box && (
                  <g ref={liftG}>
                    <rect className="sel-box" x={box.x - SEL_PAD} y={box.y - SEL_PAD} width={box.w + SEL_PAD * 2} height={box.h + SEL_PAD * 2} rx={10} />
                    {lifted}
                  </g>
                )}
                <polygon ref={loopEl} className="lasso-loop" points="" />
                <path ref={livePath} d="" />
              </svg>
              {box && !dragging && (
                <div className="sel-actions" style={{
                  left: Math.min(Math.max((box.x + box.w / 2) * scale, 120), SKETCH_WIDTH * scale - 120), // stays on the page
                  top: Math.max(4, (box.y - SEL_PAD) * scale - 52),
                }}>
                  <span className="small">{selected.length} {selected.length === 1 ? "stroke" : "strokes"} · drag to move</span>
                  <button type="button" className="tool danger" onClick={deleteSelected} aria-label="Delete the selected strokes" title="Delete (⌫)"><IconTrash /></button>
                </div>
              )}
            </div>
            <div className="sketch-foot">
              <button type="button" className="btn ghost sm" onClick={() => setHeight((h) => h + GROW_BY)}>More room</button>
              <span className="muted small">{tool === "lasso" ? "Draw a loop around strokes, then drag them. Tap outside to let go." : finger ? "Fingers draw. Tap the hand so only the Pencil does." : "The Pencil draws; fingers scroll."}</span>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
