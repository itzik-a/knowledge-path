/* The graph drawn on a canvas, laid out by src/lib/force.ts: drag the background to pan, pinch or
   scroll to zoom, drag a node to move it (the rest follow). With a mouse, hovering lights up a node and
   its neighbours and a click opens it; on a touch screen the first tap does the lighting up and shows
   the node's name with Open, a second tap opens it. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Graph, GraphNode } from "../../shared/graph.ts";
import { forceTick, makeSim, resting, type Forces, type Sim } from "../lib/force";
import { IconMinus, IconPlus, IconFit, IconNext } from "./Icons";

export interface GraphDisplay {
  /** how soon names show as you zoom in: 0 (always) … 1 (only close up) */
  labels: number;
  /** node size, 0.5 … 2 */
  size: number;
  /** link thickness, 0.5 … 3 */
  thickness: number;
}
export const DEFAULT_DISPLAY: GraphDisplay = { labels: 0.5, size: 1, thickness: 1 };

interface Palette { ink: string; muted: string; accent: string; link: string; surface: string; series: string[]; font: string }

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    ink: v("--ink"), muted: v("--muted"), accent: v("--accent"), link: v("--axis"), surface: v("--surface"),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--s${i}`)), font: v("--font"),
  };
}

/** The theme's colours, read again when the theme or accent changes. */
function usePalette() {
  const [p, setP] = useState(readPalette);
  useEffect(() => {
    const mo = new MutationObserver(() => setP(readPalette()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
    return () => mo.disconnect();
  }, []);
  return p;
}

export interface GraphCanvasProps {
  graph: Graph;
  /** a node's colour: a series index 1…8, "accent", or undefined (muted) */
  colorOf: (n: GraphNode) => number | "accent" | undefined;
  forces: Forces;
  display: GraphDisplay;
  /** the local graph's own node, ringed and always named */
  focus?: string;
  onOpen: (n: GraphNode) => void;
  /** overlays in the top corner (filter, settings button) */
  children?: ReactNode;
  /** a panel over the graph (the settings) */
  panel?: ReactNode;
  label: string;
}

interface View { k: number; tx: number; ty: number }

export function GraphCanvas({ graph, colorOf, forces, display, focus, onOpen, children, panel, label }: GraphCanvasProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pal = usePalette();
  const sim = useRef<Sim | null>(null);
  const view = useRef<View>({ k: 1, tx: 0, ty: 0 });
  /** the user moved or zoomed: stop fitting the layout to the screen */
  const steered = useRef(false);
  const hover = useRef<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const selRef = useRef<number | null>(null);
  selRef.current = selected;
  const wake = useRef<() => void>(() => {});
  const fitRef = useRef<() => void>(() => {});
  const drawRef = useRef<() => void>(() => {});
  const opts = useRef({ forces, display, pal, colorOf, focus });
  opts.current = { forces, display, pal, colorOf, focus };
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const neighbours = useMemo(() => {
    const m: number[][] = graph.nodes.map(() => []);
    for (const [a, b] of graph.edges) { m[a].push(b); m[b].push(a); }
    return m;
  }, [graph]);

  // a new graph: keep the places of the nodes that stay
  useEffect(() => {
    const s = makeSim(graph.nodes.map((n) => n.id), graph.edges, sim.current ?? undefined);
    if (reduced) for (let i = 0; i < 300 && !resting(s); i++) forceTick(s, opts.current.forces);
    sim.current = s;
    hover.current = null;
    setSelected(null);
    wake.current();
  }, [graph, reduced]);

  // settings changed: warm the layout up a little, redraw
  useEffect(() => {
    const s = sim.current;
    if (s && !reduced) s.alpha = Math.max(s.alpha, 0.3);
    wake.current();
  }, [forces, reduced]);
  useEffect(() => { wake.current(); }, [display, pal, colorOf, focus, selected]);

  // drawing and the animation loop
  useEffect(() => {
    const cv = canvas.current!, box = wrap.current!;
    const ctx = cv.getContext("2d")!;
    let w = 0, h = 0, dpr = 1, raf = 0;

    const fit = (snap: boolean) => {
      const s = sim.current;
      if (!s?.nodes.length || !w) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of s.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
      // room for the names beside and under the outer nodes, and for the buttons over the corners
      const px = Math.min(80, w / 5), py = Math.min(70, h / 6);
      const k = Math.max(0.05, Math.min((w - px * 2) / Math.max(x1 - x0, 1), (h - py * 2) / Math.max(y1 - y0, 1), 2.5));
      const to = { k, tx: -((x0 + x1) / 2) * k, ty: -((y0 + y1) / 2) * k };
      const v = view.current;
      const f = snap ? 1 : 0.12;
      view.current = { k: v.k + (to.k - v.k) * f, tx: v.tx + (to.tx - v.tx) * f, ty: v.ty + (to.ty - v.ty) * f };
    };
    fitRef.current = () => { steered.current = false; fit(true); draw(); };

    const radius = (n: GraphNode) => opts.current.display.size * (3.2 + Math.sqrt(n.degree) * 1.6);

    function draw() {
      const s = sim.current;
      const { pal: p, display: d, colorOf: col, focus: fid } = opts.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (!s) return;
      const { k, tx, ty } = view.current;
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (w / 2 + tx), dpr * (h / 2 + ty));
      const lit = hover.current ?? selRef.current;
      const near = lit != null ? new Set([lit, ...neighbours[lit]]) : null;
      const nodes = graph.nodes;

      // links
      ctx.lineWidth = (0.8 * d.thickness) / k;
      ctx.strokeStyle = p.link;
      ctx.globalAlpha = near ? 0.25 : 0.7;
      ctx.beginPath();
      for (const [a, b] of graph.edges) {
        if (near && (a === lit || b === lit)) continue;
        const A = s.nodes[a], B = s.nodes[b];
        ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      }
      ctx.stroke();
      if (lit != null) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = (1.4 * d.thickness) / k;
        ctx.beginPath();
        for (const o of neighbours[lit]) { const A = s.nodes[lit], B = s.nodes[o]; ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); }
        ctx.stroke();
      }

      // nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], sn = s.nodes[i];
        const r = Math.max(radius(n), 2 / k);
        const c = col(n);
        const fill = c === "accent" ? p.accent : c ? p.series[c - 1] : p.muted;
        ctx.globalAlpha = near && !near.has(i) ? 0.18 : 1;
        ctx.beginPath();
        ctx.arc(sn.x, sn.y, r, 0, Math.PI * 2);
        if (n.kind === "missing") {
          ctx.fillStyle = p.surface; ctx.fill();
          ctx.lineWidth = 1.2 / k; ctx.strokeStyle = p.muted; ctx.stroke();
        } else {
          ctx.fillStyle = fill; ctx.fill();
        }
        if (n.id === fid || i === lit) {
          ctx.lineWidth = 2 / k; ctx.strokeStyle = p.ink;
          ctx.beginPath(); ctx.arc(sn.x, sn.y, r + 3 / k, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // names, in screen pixels: faded in as you zoom (bigger nodes sooner); always for the lit ones
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `500 12px ${p.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = p.ink;
      const at = 0.4 + d.labels * 2.2;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], sn = s.nodes[i];
        const forced = i === lit || n.id === fid;
        let a = forced ? 1 : (k * (1 + Math.sqrt(n.degree) * 0.25) - at) / 0.4;
        if (near) a = near.has(i) ? Math.max(a, forced ? 1 : 0.9) : Math.min(a, 0.15);
        if (a <= 0.02) continue;
        const x = w / 2 + tx + sn.x * k, y = h / 2 + ty + sn.y * k + Math.max(radius(n), 2 / k) * k + 3;
        if (x < -100 || x > w + 100 || y < -20 || y > h + 20) continue;
        ctx.globalAlpha = Math.min(1, a);
        const text = n.label.length > 40 ? n.label.slice(0, 38) + "…" : n.label;
        ctx.fillText(text, x, y);
      }
      ctx.globalAlpha = 1;
    }
    drawRef.current = draw;

    const frame = () => {
      raf = 0;
      const s = sim.current;
      if (s && !resting(s) && !reduced) {
        forceTick(s, opts.current.forces);
        if (!steered.current) fit(false);
        raf = requestAnimationFrame(frame);
      } else if (s && !steered.current) {
        fit(true);
      }
      draw();
    };
    const go = () => { if (!raf) raf = requestAnimationFrame(frame); };
    wake.current = go;

    const size = () => {
      const r = box.getBoundingClientRect();
      w = r.width; h = r.height; dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + "px"; cv.style.height = h + "px";
      if (!steered.current) fit(true);
      go();
    };
    const ro = new ResizeObserver(size);
    ro.observe(box);
    size();
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); wake.current = () => {}; };
  }, [graph, neighbours, reduced]);

  // pointers: pan, drag a node, pinch, tap
  useEffect(() => {
    const cv = canvas.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let mode: "none" | "pan" | "node" | "pinch" = "none";
    let dragNode = -1;
    let start = { x: 0, y: 0, t: 0, moved: false, type: "mouse" };
    let pinch = { d: 1, mx: 0, my: 0, v: view.current };

    const local = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; };
    const toWorld = (x: number, y: number, w: number, h: number) => { const { k, tx, ty } = view.current; return { x: (x - w / 2 - tx) / k, y: (y - h / 2 - ty) / k }; };
    const hit = (x: number, y: number, w: number, h: number) => {
      const s = sim.current;
      if (!s) return -1;
      const p = toWorld(x, y, w, h);
      const { k } = view.current;
      let best = -1, bd = Infinity;
      for (let i = 0; i < s.nodes.length; i++) {
        const n = s.nodes[i];
        const r = Math.max(opts.current.display.size * (3.2 + Math.sqrt(graph.nodes[i]?.degree ?? 0) * 1.6), 2 / k) + 8 / k;
        const dd = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
        if (dd < r * r && dd < bd) { bd = dd; best = i; }
      }
      return best;
    };

    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, { x: p.x, y: p.y });
      if (pts.size === 2) {
        if (dragNode >= 0) release();
        const [a, b] = [...pts.values()];
        mode = "pinch";
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, v: { ...view.current } };
        start.moved = true;
        return;
      }
      start = { x: p.x, y: p.y, t: performance.now(), moved: false, type: e.pointerType };
      const i = hit(p.x, p.y, p.w, p.h);
      if (i >= 0) {
        mode = "node"; dragNode = i;
        const n = sim.current!.nodes[i];
        n.fx = n.x; n.fy = n.y;
      } else mode = "pan";
    };
    const release = () => {
      const s = sim.current;
      if (s && dragNode >= 0 && s.nodes[dragNode]) { const n = s.nodes[dragNode]; n.fx = undefined; n.fy = undefined; s.alphaTarget = 0; }
      dragNode = -1;
      wake.current();
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (!pts.has(e.pointerId)) {
        // hover (mouse only)
        if (e.pointerType !== "mouse") return;
        const i = hit(p.x, p.y, p.w, p.h);
        const next = i >= 0 ? i : null;
        cv.style.cursor = next != null ? "pointer" : "grab";
        if (next !== hover.current) { hover.current = next; drawRef.current(); }
        return;
      }
      const last = pts.get(e.pointerId)!;
      pts.set(e.pointerId, { x: p.x, y: p.y });
      if (Math.hypot(p.x - start.x, p.y - start.y) > 5) start.moved = true;
      if (mode === "pinch" && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const k = clampK(pinch.v.k * (d / pinch.d));
        // keep the world point under the first midpoint under the fingers
        const wx = (pinch.mx - p.w / 2 - pinch.v.tx) / pinch.v.k, wy = (pinch.my - p.h / 2 - pinch.v.ty) / pinch.v.k;
        view.current = { k, tx: mx - p.w / 2 - wx * k, ty: my - p.h / 2 - wy * k };
        steered.current = true;
        drawRef.current();
      } else if (mode === "pan") {
        if (!start.moved) return;
        const v = view.current;
        view.current = { ...v, tx: v.tx + p.x - last.x, ty: v.ty + p.y - last.y };
        steered.current = true;
        cv.style.cursor = "grabbing";
        drawRef.current();
      } else if (mode === "node" && start.moved) {
        const s = sim.current!;
        const n = s.nodes[dragNode];
        if (!n) return;
        const wpt = toWorld(p.x, p.y, p.w, p.h);
        n.fx = wpt.x; n.fy = wpt.y;
        s.alphaTarget = 0.3;
        if (s.alpha < 0.3) s.alpha = 0.3;
        steered.current = true;
        wake.current();
      }
    };
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size > 0) { mode = pts.size === 1 ? "none" : mode; return; }
      const wasNode = dragNode;
      release();
      cv.style.cursor = "grab";
      const tap = !start.moved && performance.now() - start.t < 600 && e.type === "pointerup";
      if (tap) {
        if (wasNode >= 0) {
          const n = graph.nodes[wasNode];
          if (start.type === "mouse" || selRef.current === wasNode) onOpen(n);
          else setSelected(wasNode);
        } else setSelected(null);
      }
      mode = "none";
    };
    const leave = (e: PointerEvent) => { if (e.pointerType === "mouse" && hover.current != null && !pts.size) { hover.current = null; drawRef.current(); } };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const v = view.current;
      const k = clampK(v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0025)));
      const wx = (p.x - p.w / 2 - v.tx) / v.k, wy = (p.y - p.h / 2 - v.ty) / v.k;
      view.current = { k, tx: p.x - p.w / 2 - wx * k, ty: p.y - p.h / 2 - wy * k };
      steered.current = true;
      drawRef.current();
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", leave);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("pointerleave", leave);
      cv.removeEventListener("wheel", wheel);
    };
  }, [graph, onOpen]);

  const zoom = (f: number) => {
    const v = view.current;
    const k = clampK(v.k * f);
    view.current = { k, tx: (v.tx * k) / v.k, ty: (v.ty * k) / v.k };
    steered.current = true;
    drawRef.current();
  };

  const sel = selected != null ? graph.nodes[selected] : undefined;
  return (
    <div className="graph-wrap" ref={wrap}>
      <canvas ref={canvas} className="graph-canvas" role="img" aria-label={label} />
      {children && <div className="graph-top">{children}</div>}
      <div className="graph-zoom" role="group" aria-label="Zoom">
        <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1.4)}><IconPlus /></button>
        <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1 / 1.4)}><IconMinus /></button>
        <button type="button" className="icon-btn" aria-label="Fit the graph to the screen" title="Fit" onClick={() => fitRef.current()}><IconFit /></button>
      </div>
      {sel && (
        <button type="button" className="graph-sel" onClick={() => onOpen(sel)}>
          <span className="clamp1" dir="auto">{sel.label}</span>
          <span className="muted small">{sel.degree === 1 ? "1 link" : `${sel.degree} links`}</span>
          <span className="graph-sel-open">Open <IconNext width={16} height={16} /></span>
        </button>
      )}
      {!graph.nodes.length && <p className="graph-empty muted">Nothing to show with these filters.</p>}
      {panel}
    </div>
  );
}

const clampK = (k: number) => Math.min(8, Math.max(0.05, k));
