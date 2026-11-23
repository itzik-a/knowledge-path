/* Everything the app knows about the vault, worked out from the files: topics and their tree,
   which items are in which topic, links, backlinks and tags. Rebuilt after every change; each
   file is only parsed again when its text changed (parseDoc is cached by the caller). */
import {
  basename, dirname, excerpt, extractLinks, extractTags, firstLine, FOLDER, journalDate, kindOf, refTarget, resourceOf,
  slug, splitFrontmatter, strList, type Kind, type Link, type Resource,
} from "./vault.ts";
import { habitOf, parseLog, type Habit, type LogEntry } from "./habits.ts";
import { parseRecipe, recipeOf, summarize, type Recipe, type RecipeSummary } from "./recipes.ts";
import { isLockedName, sealedPayload } from "./private.ts";

export interface Doc {
  path: string;
  kind: Kind;
  name: string;
  title: string;
  fm: Record<string, unknown>;
  body: string;
  links: Link[];
  tags: string[];
  topicRefs: string[];
  resource?: Resource;
  habit?: Habit;
  /** a habit's log, newest first */
  log?: LogEntry[];
  recipe?: Recipe;
  /** a recipe's ingredient names, the days it was cooked (newest first) and its total time */
  cooking?: RecipeSummary;
  date?: string;
  excerpt: string;
  mtime: number;
  /** `private: true`: encrypted in the vault (shared/private.ts) */
  private?: boolean;
  /** still encrypted on this device (no passphrase yet): the body is empty here */
  sealed?: boolean;
}

export interface Topic {
  id: string;
  name: string;
  path: string;
  parent?: string;
  children: string[];
  icon?: string;
  color?: number;
  description?: string;
  depth: number;
}

export interface Index {
  docs: Map<string, Doc>;
  topics: Map<string, Topic>;
  /** top-level topics, then each one's children, depth first, sorted by name */
  topicOrder: string[];
  /** item path → topic ids it belongs to directly */
  topicsOf: Map<string, string[]>;
  /** topic id → item paths directly in it */
  itemsOf: Map<string, string[]>;
  backlinks: Map<string, string[]>;
  tags: Map<string, string[]>;
  byName: Map<string, string[]>;
}

export function parseDoc(path: string, content: string, mtime = 0): Doc {
  const kind = kindOf(path);
  const split = splitFrontmatter(content);
  const { fm } = split;
  const sealed = sealedPayload(split.body) != null;
  const body = sealed ? "" : split.body;
  const name = basename(path);
  const date = kind === "journal" ? journalDate(path) : undefined;
  const fmTitle = typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : undefined;
  return {
    path, kind, name, fm, body, mtime, date,
    private: fm.private === true || undefined, sealed: sealed || undefined,
    // a locked note's file name is neutral: its title is in its frontmatter (or its first line, or just "Locked note")
    title: fmTitle ?? (isLockedName(name) ? firstLine(body) || "Locked note" : name === "Untitled" ? firstLine(body) || name : name),
    links: kind === "hub" ? [] : extractLinks(body),
    tags: kind === "hub" ? [] : extractTags(body, fm),
    topicRefs: strList(fm.topics).map(refTarget).filter(Boolean),
    resource: kind === "resource" ? resourceOf(fm) : undefined,
    habit: kind === "habit" ? habitOf(fm) : undefined,
    log: kind === "habit" ? parseLog(body) : undefined,
    recipe: kind === "recipe" ? recipeOf(fm) : undefined,
    cooking: kind === "recipe" ? summarize(recipeOf(fm), body) : undefined,
    excerpt: kind === "hub" ? "" : excerpt(kind === "habit" ? body.replace(/^##\s+log\s*$[\s\S]*/im, "") : kind === "recipe" ? parseRecipe(body).intro : body),
  };
}

export const topicIdOf = (path: string) => path.slice(FOLDER.topics.length + 1).replace(/\.md$/i, "");

/** Resolve a [[link]] target to a path, the way Obsidian does: by file name, or by path when it has a folder. */
export function resolve(ix: Pick<Index, "byName" | "docs">, target: string, from?: string): string | undefined {
  const t = target.replace(/\.md$/i, "").trim();
  if (!t) return undefined;
  const key = t.toLowerCase();
  if (key.includes("/")) {
    const exact = ix.docs.has(t + ".md") ? t + ".md" : undefined;
    if (exact) return exact;
    for (const p of ix.docs.keys()) {
      const lp = p.toLowerCase().replace(/\.md$/, "");
      if (lp === key || lp.endsWith("/" + key)) return p;
    }
    return undefined;
  }
  const c = ix.byName.get(key);
  if (!c?.length) return undefined;
  if (c.length === 1 || !from) return c[0];
  const dir = dirname(from);
  return c.find((p) => dirname(p) === dir) ?? c[0];
}

export function buildIndex(docs: Map<string, Doc>): Index {
  const byName = new Map<string, string[]>();
  for (const p of docs.keys()) {
    const k = basename(p).toLowerCase();
    const arr = byName.get(k);
    if (arr) arr.push(p); else byName.set(k, [p]);
  }
  for (const arr of byName.values()) arr.sort((a, b) => a.length - b.length || a.localeCompare(b));

  // topics
  const topics = new Map<string, Topic>();
  for (const d of docs.values()) {
    if (d.kind !== "topic") continue;
    const id = topicIdOf(d.path);
    const color = typeof d.fm.color === "number" ? d.fm.color : undefined;
    topics.set(id, {
      id, name: d.title, path: d.path, children: [], depth: 0,
      icon: typeof d.fm.icon === "string" ? d.fm.icon : undefined,
      color: color && color >= 1 && color <= 8 ? Math.round(color) : undefined,
      description: typeof d.fm.description === "string" ? d.fm.description : undefined,
    });
  }
  for (const t of topics.values()) {
    // parent: the nearest folder above that is itself a topic
    const parts = t.id.split("/");
    for (let n = parts.length - 1; n > 0; n--) {
      const pid = parts.slice(0, n).join("/");
      if (topics.has(pid)) { t.parent = pid; break; }
    }
    if (t.parent) topics.get(t.parent)!.children.push(t.id);
  }
  const byTopicName = (a: string, b: string) => topics.get(a)!.name.localeCompare(topics.get(b)!.name);
  const topicOrder: string[] = [];
  const walk = (id: string, depth: number) => {
    const t = topics.get(id)!;
    t.depth = depth;
    t.children.sort(byTopicName);
    topicOrder.push(id);
    for (const c of t.children) walk(c, depth + 1);
  };
  [...topics.values()].filter((t) => !t.parent).map((t) => t.id).sort(byTopicName).forEach((id) => walk(id, 0));
  // inherit icon and colour from the parent
  for (const id of topicOrder) {
    const t = topics.get(id)!;
    if (t.parent) {
      const p = topics.get(t.parent)!;
      t.icon ??= p.icon;
      t.color ??= p.color;
    }
  }

  // topic lookup by id, name and tag
  const topicKey = new Map<string, string>();
  for (const id of topicOrder) {
    const t = topics.get(id)!;
    topicKey.set(id.toLowerCase(), id);
    if (!topicKey.has(t.name.toLowerCase())) topicKey.set(t.name.toLowerCase(), id);
  }
  const topicTag = new Map<string, string>();
  for (const id of topicOrder) {
    const t = topics.get(id)!;
    topicTag.set(slug(id), id);
    if (!topicTag.has(slug(t.name))) topicTag.set(slug(t.name), id);
  }
  const findTopic = (ref: string) => topicKey.get(ref.toLowerCase()) ?? topicKey.get(basename(ref).toLowerCase());

  const ix: Index = { docs, topics, topicOrder, topicsOf: new Map(), itemsOf: new Map(), backlinks: new Map(), tags: new Map(), byName };
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); if (a) { if (!a.includes(v)) a.push(v); } else m.set(k, [v]); };

  for (const d of docs.values()) {
    if (d.kind === "hub") continue;
    for (const l of d.links) {
      const p = resolve(ix, l.target, d.path);
      if (p && p !== d.path) push(ix.backlinks, p, d.path);
    }
    for (const t of d.tags) push(ix.tags, t, d.path);
    if (d.kind === "topic") continue;
    const mine = new Set<string>();
    for (const r of d.topicRefs) { const id = findTopic(r); if (id) mine.add(id); }
    for (const l of d.links) {
      const p = resolve(ix, l.target, d.path);
      if (p && docs.get(p)?.kind === "topic") mine.add(topicIdOf(p));
    }
    for (const tag of d.tags) { const id = topicTag.get(tag); if (id) mine.add(id); }
    if (mine.size) {
      ix.topicsOf.set(d.path, [...mine]);
      for (const id of mine) push(ix.itemsOf, id, d.path);
    }
  }
  return ix;
}

/** A topic and all the topics under it. */
export function subtree(ix: Index, id: string): string[] {
  const out: string[] = [];
  const go = (x: string) => { out.push(x); for (const c of ix.topics.get(x)?.children ?? []) go(c); };
  if (ix.topics.has(id)) go(id);
  return out;
}

/** Items in a topic, with or without its subtopics. */
export function itemsIn(ix: Index, id: string, deep = true): Doc[] {
  const ids = deep ? subtree(ix, id) : [id];
  const seen = new Set<string>();
  const out: Doc[] = [];
  for (const t of ids) for (const p of ix.itemsOf.get(t) ?? []) {
    if (seen.has(p)) continue;
    seen.add(p);
    const d = ix.docs.get(p);
    if (d) out.push(d);
  }
  return out;
}

/** The chain of topics from the top down to this one. */
export function ancestry(ix: Index, id: string): Topic[] {
  const out: Topic[] = [];
  for (let t = ix.topics.get(id); t; t = t.parent ? ix.topics.get(t.parent) : undefined) out.unshift(t);
  return out;
}

/** Items waiting to be sorted: resources and notes in no topic yet. */
export function inbox(ix: Index): Doc[] {
  return [...ix.docs.values()]
    .filter((d) => (d.kind === "resource" || d.kind === "note") && !ix.topicsOf.has(d.path))
    .sort((a, b) => b.mtime - a.mtime);
}

/** Top-level topic of an item (for its colour). */
export function rootTopic(ix: Index, id: string): Topic | undefined {
  return ancestry(ix, id)[0];
}
