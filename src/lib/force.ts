/* A small force layout for the graph view (no DOM): nodes push each other apart (Barnes–Hut, so a few
   thousand nodes stay quick), links pull their ends to a distance, and a pull toward the middle keeps
   loose clusters near. The same scheme as d3-force: velocities decay, and `alpha` cools down until the
   layout rests; dragging a node warms it up again (`alphaTarget`). */

export interface SimNode {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  /** held in place (being dragged) */
  fx?: number; fy?: number;
}

export interface Sim {
  nodes: SimNode[];
  links: [number, number][];
  /** links per node (springs on busy nodes are softer) */
  deg: number[];
  alpha: number;
  alphaTarget: number;
}

/** The settings' sliders, each 0…2 or so with 1 the usual. */
export interface Forces { center: number; repel: number; link: number; distance: number }
export const DEFAULT_FORCES: Forces = { center: 0.5, repel: 1, link: 1, distance: 1 };

const ALPHA_MIN = 0.002;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
const VELOCITY_DECAY = 0.4;
const THETA2 = 0.81;

/** A new layout; nodes that were in `prev` keep their place (so a filter change doesn't scramble it). */
export function makeSim(ids: string[], links: [number, number][], prev?: Sim): Sim {
  const was = new Map(prev?.nodes.map((n) => [n.id, n]));
  const deg = ids.map(() => 0);
  for (const [a, b] of links) { deg[a]++; deg[b]++; }
  let fresh = 0;
  const nodes = ids.map((id, i): SimNode => {
    const o = was.get(id);
    if (o) return { id, x: o.x, y: o.y, vx: 0, vy: 0 };
    // new ones on a sunflower spiral (around a linked neighbour that has a place, when there is one)
    const k = fresh++;
    const r = 10 * Math.sqrt(0.5 + k), a = k * Math.PI * (3 - Math.sqrt(5));
    let cx = 0, cy = 0;
    if (was.size) for (const [s, t] of links) {
      const other = s === i ? ids[t] : t === i ? ids[s] : undefined;
      const p = other && was.get(other);
      if (p) { cx = p.x; cy = p.y; break; }
    }
    return { id, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), vx: 0, vy: 0 };
  });
  return { nodes, links, deg, alpha: prev && fresh < ids.length ? 0.5 : 1, alphaTarget: 0 };
}

export const resting = (s: Sim) => s.alpha < ALPHA_MIN && s.alphaTarget === 0;

interface Quad {
  x0: number; y0: number; size: number;
  mass: number; cx: number; cy: number;
  /** a leaf's node (or the first of several in the same spot) */
  node?: SimNode;
  kids?: (Quad | undefined)[];
}

function quadtree(nodes: SimNode[]): Quad {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
  const size = Math.max(x1 - x0, y1 - y0, 1) * 1.001;
  const root: Quad = { x0, y0, size, mass: 0, cx: 0, cy: 0 };
  for (const n of nodes) insert(root, n, 0);
  accumulate(root);
  return root;
}

function insert(q: Quad, n: SimNode, depth: number) {
  if (!q.kids && !q.node) { q.node = n; return; }
  if (!q.kids) {
    // a leaf: split it, unless it's too deep (nodes on the same spot stay together)
    if (depth > 24) { q.mass += 1; return; }
    const old = q.node!;
    q.node = undefined;
    q.kids = [undefined, undefined, undefined, undefined];
    place(q, old, depth);
  }
  place(q, n, depth);
}

function place(q: Quad, n: SimNode, depth: number) {
  const h = q.size / 2;
  const right = n.x >= q.x0 + h ? 1 : 0, down = n.y >= q.y0 + h ? 1 : 0;
  const i = right + 2 * down;
  const kid = q.kids![i] ??= { x0: q.x0 + right * h, y0: q.y0 + down * h, size: h, mass: 0, cx: 0, cy: 0 };
  insert(kid, n, depth + 1);
}

function accumulate(q: Quad) {
  if (q.kids) {
    let m = 0, x = 0, y = 0;
    for (const k of q.kids) if (k) { accumulate(k); m += k.mass; x += k.cx * k.mass; y += k.cy * k.mass; }
    q.mass = m; q.cx = m ? x / m : 0; q.cy = m ? y / m : 0;
  } else if (q.node) {
    q.mass += 1; q.cx = q.node.x; q.cy = q.node.y;
  }
}

/** Push `n` away from everything in `q`. */
function repel(q: Quad, n: SimNode, k: number) {
  if (!q.mass) return;
  if (!q.kids) {
    // a leaf: one node (or a few in the same spot)
    if (q.node === n) { if (q.mass > 1) { n.vx += Math.random() - 0.5; n.vy += Math.random() - 0.5; } return; }
    push(q, n, k);
    return;
  }
  const dx = q.cx - n.x, dy = q.cy - n.y;
  if ((q.size * q.size) / (dx * dx + dy * dy || 1e-9) < THETA2) { push(q, n, k); return; }
  for (const kid of q.kids) if (kid) repel(kid, n, k);
}

function push(q: Quad, n: SimNode, k: number) {
  let dx = q.cx - n.x, dy = q.cy - n.y;
  if (dx === 0 && dy === 0) { dx = (Math.random() - 0.5) * 1e-3; dy = (Math.random() - 0.5) * 1e-3; }
  let l = dx * dx + dy * dy;
  if (l < 1) l = Math.sqrt(l);
  const w = (k * q.mass) / l;
  n.vx += dx * w; n.vy += dy * w;
}

export function forceTick(s: Sim, f: Forces) {
  const { nodes, links, deg } = s;
  if (!nodes.length) return;
  s.alpha += (s.alphaTarget - s.alpha) * ALPHA_DECAY;
  const alpha = s.alpha;

  // links: a spring to `distance`, softer on the busier end
  const dist = 36 * f.distance + 6;
  for (const [ia, ib] of links) {
    const a = nodes[ia], b = nodes[ib];
    let dx = b.x + b.vx - a.x - a.vx, dy = b.y + b.vy - a.y - a.vy;
    if (dx === 0 && dy === 0) { dx = 1e-3; dy = 1e-3; }
    const l = Math.sqrt(dx * dx + dy * dy);
    const k = ((l - dist) / l) * alpha * f.link * (1 / Math.min(deg[ia], deg[ib]));
    const bias = deg[ia] / (deg[ia] + deg[ib]);
    dx *= k; dy *= k;
    b.vx -= dx * (1 - bias); b.vy -= dy * (1 - bias);
    a.vx += dx * bias; a.vy += dy * bias;
  }

  // everything pushes everything apart
  if (f.repel > 0) {
    const root = quadtree(nodes);
    const k = -60 * f.repel * alpha;
    for (const n of nodes) repel(root, n, k);
  }

  // toward the middle
  const c = 0.02 * f.center * alpha;
  for (const n of nodes) { n.vx -= n.x * c; n.vy -= n.y * c; }

  for (const n of nodes) {
    if (n.fx != null) { n.x = n.fx; n.vx = 0; } else { n.vx *= 1 - VELOCITY_DECAY; n.x += n.vx; }
    if (n.fy != null) { n.y = n.fy; n.vy = 0; } else { n.vy *= 1 - VELOCITY_DECAY; n.y += n.vy; }
  }
}
