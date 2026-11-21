/* Full-text search over the whole vault, on this device (MiniSearch). The index is kept up to date
   incrementally: only files whose text changed are re-indexed. */
import MiniSearch from "minisearch";
import type { Doc, Index } from "../../shared/index.ts";

interface Row { id: string; title: string; body: string; tags: string; author: string; topics: string }

let ms: MiniSearch<Row> | null = null;
const seen = new Map<string, Doc>();

function make() {
  return new MiniSearch<Row>({
    fields: ["title", "author", "tags", "topics", "body"],
    storeFields: [],
    searchOptions: { boost: { title: 4, author: 2, tags: 2, topics: 1.5 }, prefix: true, fuzzy: 0.2, combineWith: "AND" },
    // Hebrew and English: split on anything that isn't a letter or digit
    tokenize: (s) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
    processTerm: (t) => t.toLowerCase().replace(/[֑-ׇ]/g, ""), // drop Hebrew vowel marks
  });
}

function row(d: Doc, ix: Index): Row {
  const topics = (ix.topicsOf.get(d.path) ?? []).map((id) => ix.topics.get(id)?.name ?? "").join(" ");
  return { id: d.path, title: d.title, body: d.body, tags: d.tags.join(" "), author: d.resource?.author ?? "", topics };
}

export function updateSearch(ix: Index) {
  ms ??= make();
  for (const [p, d] of seen) {
    if (ix.docs.get(p) !== d) { ms.discard(p); seen.delete(p); }
  }
  for (const d of ix.docs.values()) {
    if (d.kind === "hub" || seen.has(d.path)) continue;
    ms.add(row(d, ix));
    seen.set(d.path, d);
  }
}

export function search(ix: Index, q: string, limit = 40): Doc[] {
  if (!q.trim()) return [];
  updateSearch(ix);
  let hits = ms!.search(q);
  if (!hits.length) hits = ms!.search(q, { combineWith: "OR" });
  return hits.slice(0, limit).map((h) => ix.docs.get(h.id as string)).filter((d): d is Doc => !!d);
}

/** A snippet of the body around the first match of any query word. */
export function snippet(body: string, q: string, len = 120): string {
  const plain = body.replace(/^---[\s\S]*?---\n/, "").replace(/[#>*_`[\]]/g, "").replace(/\s+/g, " ").trim();
  const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const lower = plain.toLowerCase();
  let at = -1;
  for (const w of words) { const i = lower.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return plain.slice(0, len);
  const start = Math.max(0, at - 40);
  return (start > 0 ? "…" : "") + plain.slice(start, start + len) + (start + len < plain.length ? "…" : "");
}
