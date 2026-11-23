/* Sketches: drawings made with the Apple Pencil (or a finger or mouse), kept in the vault as plain SVG
   files under Sketches/ and embedded in a note with ![[Sketch 2026-11-23 14.05.12.svg]], which Obsidian
   shows as an image too. Free of DOM and Node APIs, like vault.ts.

   The file is written one stroke per line, so a sync can merge strokes added on two devices:
     <svg xmlns="http://www.w3.org/2000/svg" data-sketch="knowledge-path" viewBox="0 0 1000 640" width="1000" height="640">
     <path fill="#FFD60A" fill-opacity="0.35" d="M…Z"/>     highlighter strokes first, so they sit under the ink
     <path fill="#1C1C1E" d="M…Z"/>                          each stroke is a filled outline (its width follows the pressure)
     </svg>
   Coordinates are in a 1000-unit-wide space whatever the screen; the height grows with the drawing. */

export const SKETCH_FOLDER = "Sketches";
export const SKETCH_WIDTH = 1000;
export const SKETCH_MARK = "knowledge-path";

/** The ink colours (stored as written). INK is shown in the theme's text colour, so it reads in dark mode. */
export const INK = "#1C1C1E";
export const PEN_COLORS = [INK, "#2A78D6", "#E34948", "#1BAF7A"] as const;
export const HIGHLIGHT = "#FFD60A";
export const HIGHLIGHT_OPACITY = 0.35;

export interface Stroke {
  d: string;
  fill: string;
  /** below 1: a highlighter stroke */
  opacity?: number;
}

export interface Sketch { width: number; height: number; strokes: Stroke[] }

export const isSketchPath = (path: string) => /\.svg$/i.test(path);

/** "Sketch 2026-11-23 14.05.12.svg", the way Obsidian names drawings (no ":" in file names). */
export function sketchName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Sketch ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.svg`;
}

const SAFE_D = /^[MLQTCZmlqtcz0-9.,\s-]+$/;
const SAFE_FILL = /^#[0-9a-f]{3,8}$/i;

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** A sketch this app wrote, or null for any other SVG (shown as a plain image, never edited). */
export function parseSketch(svg: string): Sketch | null {
  const open = /<svg\b[^>]*>/.exec(svg)?.[0];
  if (!open || attr(open, "data-sketch") !== SKETCH_MARK) return null;
  const vb = (attr(open, "viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const width = vb.length === 4 && vb[2] > 0 ? vb[2] : SKETCH_WIDTH;
  const height = vb.length === 4 && vb[3] > 0 ? vb[3] : Math.round(width * 0.6);
  const strokes: Stroke[] = [];
  for (const m of svg.matchAll(/<path\b[^>]*>/g)) {
    const d = attr(m[0], "d");
    const fill = attr(m[0], "fill") ?? INK;
    if (!d || !SAFE_D.test(d) || !SAFE_FILL.test(fill)) continue;
    const op = Number(attr(m[0], "fill-opacity"));
    strokes.push(op > 0 && op < 1 ? { d, fill, opacity: op } : { d, fill });
  }
  return { width, height, strokes };
}

/** Highlighter strokes first (under the ink), each group in the order drawn. */
export const layered = (strokes: Stroke[]) => [...strokes.filter((s) => s.opacity != null), ...strokes.filter((s) => s.opacity == null)];

export function serializeSketch(s: Sketch): string {
  const w = Math.round(s.width), h = Math.round(s.height);
  const lines = layered(s.strokes)
    .filter((k) => SAFE_D.test(k.d) && SAFE_FILL.test(k.fill))
    .map((k) => `<path fill="${k.fill}"${k.opacity != null ? ` fill-opacity="${k.opacity}"` : ""} d="${k.d}"/>`);
  return [`<svg xmlns="http://www.w3.org/2000/svg" data-sketch="${SKETCH_MARK}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`, ...lines, "</svg>", ""].join("\n");
}

const r1 = (n: number) => String(Math.round(n * 10) / 10);

/** An outline polygon (from perfect-freehand) as smooth SVG path data: quadratic curves through the midpoints. */
export function outlineToPath(points: number[][]): string {
  const n = points.length;
  if (n < 2) return "";
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const pt = (p: number[]) => `${r1(p[0])},${r1(p[1])}`;
  if (n < 4) return `M${pt(points[0])} ${points.slice(1).map((p) => `L${pt(p)}`).join(" ")} Z`;
  const out = [`M${pt(points[0])}`, `Q${pt(points[1])} ${pt(mid(points[1], points[2]))}`, "T"];
  const t: string[] = [];
  for (let i = 2; i < n - 1; i++) t.push(pt(mid(points[i], points[i + 1])));
  return `${out.join(" ")}${t.join(" ")} Z`;
}

/** The lowest point of a stroke (the largest y), to trim the empty space below a drawing. */
export function strokeBottom(d: string): number {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  let max = 0;
  for (let i = 1; i < nums.length; i += 2) if (nums[i] > max) max = nums[i];
  return max;
}

/** The height to save: just below the drawing, never less than a small strip. */
export function trimmedHeight(strokes: Stroke[], min = 240, pad = 40): number {
  const bottom = strokes.reduce((m, s) => Math.max(m, strokeBottom(s.d)), 0);
  return Math.max(min, Math.ceil(bottom + pad));
}

/** Embeds of sketches in a note body: the file names in ![[… .svg]]. */
export function sketchEmbeds(body: string): string[] {
  return [...body.matchAll(/!\[\[([^\]|#\n]+?\.svg)(?:[|#][^\]\n]*)?\]\]/gi)].map((m) => m[1].trim());
}

/** The body without the lines that embed this sketch (and the blank line left behind). */
export function removeEmbed(body: string, name: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`!\\[\\[(?:[^\\]\\n]*/)?${esc}(?:[|#][^\\]\\n]*)?\\]\\]`, "gi");
  return body
    .split("\n")
    .map((l) => { const next = l.replace(re, ""); return next === l ? l : next.trimEnd(); })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Add an embed at the end of a body, on its own paragraph. */
export function appendEmbed(body: string, name: string): string {
  const b = body.replace(/\s+$/, "");
  return `${b}${b ? "\n\n" : ""}![[${name}]]\n`;
}

/** A sketch as inline SVG markup for a reading view: the default ink in the text colour (currentColor), so
    it reads in dark mode; everything else as stored. Only checked path data and colours get through. */
export function sketchMarkup(s: Sketch, cls = "sketch-svg"): string {
  const paths = layered(s.strokes)
    .filter((k) => SAFE_D.test(k.d) && SAFE_FILL.test(k.fill))
    .map((k) => `<path fill="${k.fill.toUpperCase() === INK ? "currentColor" : k.fill}"${k.opacity != null ? ` fill-opacity="${k.opacity}"` : ""} d="${k.d}"/>`)
    .join("");
  return `<svg class="${cls}" viewBox="0 0 ${Math.round(s.width)} ${Math.round(s.height)}" aria-hidden="true">${paths}</svg>`;
}

/** Two devices changed the same sketch: keep the strokes either one added, drop the ones either one
    erased. Null if any side isn't a sketch of ours (then it's merged as text). */
export function mergeSketch(base: string, mine: string, theirs: string): string | null {
  const b = parseSketch(base), m = parseSketch(mine), t = parseSketch(theirs);
  if (!m || !t) return null;
  const key = (s: Stroke) => `${s.fill}|${s.opacity ?? 1}|${s.d}`;
  const inBase = new Set((b?.strokes ?? []).map(key));
  const inMine = new Set(m.strokes.map(key));
  const inTheirs = new Set(t.strokes.map(key));
  const keepTheirs = t.strokes.filter((s) => inMine.has(key(s)) || !inBase.has(key(s)));
  const addedByMe = m.strokes.filter((s) => !inBase.has(key(s)) && !inTheirs.has(key(s)));
  return serializeSketch({ width: t.width, height: Math.max(m.height, t.height), strokes: [...keepTheirs, ...addedByMe] });
}

// ── the lasso: select strokes inside a loop, move them ──

/** A stroke's outline points (every coordinate pair in its path data). */
export function strokePoints(d: string): [number, number][] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/** Even-odd test: is the point inside the polygon (closed implicitly)? */
export function inPolygon(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A stroke is caught by the lasso when at least half of its outline is inside the loop. */
export function inLasso(d: string, loop: number[][]): boolean {
  if (loop.length < 3) return false;
  const pts = strokePoints(d);
  if (!pts.length) return false;
  return pts.filter(([x, y]) => inPolygon(x, y, loop)).length * 2 >= pts.length;
}

/** The same stroke moved by dx, dy. */
export function moveStroke(s: Stroke, dx: number, dy: number): Stroke {
  let i = 0;
  const d = s.d.replace(/-?\d+(?:\.\d+)?/g, (n) => r1(Number(n) + (i++ % 2 === 0 ? dx : dy)));
  return { ...s, d };
}

export interface Box { x: number; y: number; w: number; h: number }

/** The box around some strokes. */
export function boundsOf(strokes: Stroke[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of strokePoints(s.d)) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
