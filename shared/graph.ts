/* The graph view's data (DOM- and Node-free): every file as a node, every [[link]] between two files as
   an edge, the way Obsidian's graph shows a vault. Links count from the body and from frontmatter
   (`topics: ["[[Stoicism]]"]`, a chapter's `book: "[[…]]"`), a subtopic links to its parent topic, and
   tags and links to notes that don't exist yet can be nodes too. Filters drop nodes with their edges;
   a local graph keeps only what is within `depth` links of one file. */
import { ancestry, resolve, topicIdOf, type Index } from "./index.ts";
import type { Kind } from "./vault.ts";
import { isTemplatePath } from "./templates.ts";

export type NodeKind = Exclude<Kind, "hub"> | "tag" | "missing";

export interface GraphNode {
  /** the file's path, `tag:<tag>` or `missing:<target>` */
  id: string;
  label: string;
  kind: NodeKind;
  /** the file's top-level topic, for "colour by topic" */
  topic?: string;
  degree: number;
}

export interface Graph {
  nodes: GraphNode[];
  /** pairs of indices into `nodes`, each pair once, never a node to itself */
  edges: [number, number][];
}

/** What the graph shows. The kinds that are off are left out with their links. */
export interface GraphShow {
  topics: boolean;
  resources: boolean;
  journal: boolean;
  chapters: boolean;
  /** habits, recipes and study paths */
  other: boolean;
  tags: boolean;
  /** links to notes not written yet */
  missing: boolean;
  /** nodes with no links (in the global graph) */
  orphans: boolean;
}

export const DEFAULT_SHOW: GraphShow = { topics: true, resources: true, journal: true, chapters: false, other: true, tags: false, missing: false, orphans: true };

export interface GraphQuery {
  show: GraphShow;
  /** keep only files whose title or path has this text (and the links among them) */
  search?: string;
  /** a local graph: this file and what is within `depth` links of it */
  local?: { path: string; depth: number };
}

/** Which switch a kind of node is under (notes are always shown). */
function shown(kind: NodeKind, s: GraphShow): boolean {
  switch (kind) {
    case "note": return true;
    case "topic": return s.topics;
    case "resource": return s.resources;
    case "journal": return s.journal;
    case "chapter": return s.chapters;
    case "habit": case "recipe": case "path": return s.other;
    case "tag": return s.tags;
    case "missing": return s.missing;
  }
}

const FM_LINK = /\[\[([^\]\n]+?)\]\]/g;

/** [[links]] in frontmatter values (strings, lists of strings, nested). */
export function frontmatterLinks(fm: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 3 || v == null) return;
    if (typeof v === "string") { for (const m of v.matchAll(FM_LINK)) out.push(m[1].split("|")[0].split("#")[0].trim()); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (typeof v === "object" && !(v instanceof Date)) Object.values(v as Record<string, unknown>).forEach((x) => walk(x, depth + 1));
  };
  walk(fm, 0);
  return out.filter(Boolean);
}

/** A link to something that isn't a note (a sketch, a picture, a PDF): not a node. */
const isAttachment = (target: string) => /\.(?!md$)[a-z0-9]{2,5}$/i.test(target);

export function buildGraph(ix: Index, q: GraphQuery): Graph {
  // every node and edge first, kinds filtered
  const nodes = new Map<string, GraphNode>();
  const adj = new Map<string, Set<string>>();
  const node = (id: string, label: string, kind: NodeKind, topic?: string) => {
    if (!nodes.has(id)) { nodes.set(id, { id, label, kind, topic, degree: 0 }); adj.set(id, new Set()); }
  };
  const topicOfDoc = (path: string, kind: Kind): string | undefined => {
    const own = kind === "topic" ? topicIdOf(path) : ix.topicsOf.get(path)?.[0];
    return own ? ancestry(ix, own)[0]?.id : undefined;
  };

  for (const d of ix.docs.values()) {
    if (d.kind === "hub" || isTemplatePath(d.path) || !shown(d.kind, q.show)) continue;
    node(d.path, d.title, d.kind, topicOfDoc(d.path, d.kind));
  }
  const link = (a: string, b: string) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const d of ix.docs.values()) {
    if (!nodes.has(d.path)) continue;
    const targets = [...d.links.map((l) => l.target), ...frontmatterLinks(d.fm)];
    for (const t of targets) {
      if (isAttachment(t)) continue;
      const p = resolve(ix, t, d.path);
      if (p) { link(d.path, p); continue; }
      if (!q.show.missing) continue;
      const name = t.replace(/\.md$/i, "").trim();
      if (!name) continue;
      const id = "missing:" + name.toLowerCase();
      node(id, name.split("/").pop()!, "missing");
      link(d.path, id);
    }
    if (q.show.tags) for (const tag of d.tags) {
      const id = "tag:" + tag;
      node(id, "#" + tag, "tag");
      link(d.path, id);
    }
    if (d.kind === "topic") {
      const parent = ix.topics.get(topicIdOf(d.path))?.parent;
      if (parent) link(d.path, ix.topics.get(parent)!.path);
    }
  }

  // which nodes stay
  let keep: Set<string>;
  if (q.local) {
    keep = new Set();
    if (nodes.has(q.local.path)) {
      let ring = [q.local.path];
      keep.add(q.local.path);
      for (let n = 0; n < q.local.depth && ring.length; n++) {
        const next: string[] = [];
        for (const id of ring) for (const o of adj.get(id)!) if (!keep.has(o)) { keep.add(o); next.push(o); }
        ring = next;
      }
    }
  } else {
    keep = new Set(nodes.keys());
  }
  const s = q.search?.trim().toLowerCase();
  if (s) for (const id of [...keep]) {
    const n = nodes.get(id)!;
    if (id === q.local?.path) continue;
    if (!n.label.toLowerCase().includes(s) && !id.toLowerCase().includes(s)) keep.delete(id);
  }

  const kept = [...keep].map((id) => nodes.get(id)!);
  const at = new Map(kept.map((n, i) => [n.id, i]));
  const edges: [number, number][] = [];
  for (const n of kept) {
    n.degree = 0;
    for (const o of adj.get(n.id)!) {
      const j = at.get(o);
      if (j == null) continue;
      n.degree++;
      const i = at.get(n.id)!;
      if (i < j) edges.push([i, j]);
    }
  }
  if (q.local || q.show.orphans) return { nodes: kept, edges };
  // drop orphans and renumber
  const live = kept.filter((n) => n.degree > 0);
  const re = new Map(live.map((n, i) => [at.get(n.id)!, i]));
  return { nodes: live, edges: edges.map(([a, b]) => [re.get(a)!, re.get(b)!]) };
}

export const KIND_ORDER: NodeKind[] = ["note", "topic", "resource", "journal", "chapter", "path", "habit", "recipe", "tag", "missing"];
