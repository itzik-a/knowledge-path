/* Books from the Rudolf Steiner Archive (rsarchive.org), read here chapter by chapter.
   Used by the app and the enricher, so it stays free of DOM and Node APIs.

   A saved link (a resource) is the book's home: its status, rating, topics, notes and highlights.
   "Make it a book" sets `book: pending` on it; the enricher (enricher/rsarchive/, run from the vault's
   workflow) fetches the book and writes:
     - one note per chapter in Books/<Title (GA n)>/<NN chapter>.md (kind "chapter"): frontmatter
       book: "[[<home>]]", order, section, date, place, translator, source, german, summary; the text
       with [^1] footnotes and Obsidian block ids on numbered paragraphs (… ^p12), images linked on
       rsarchive.org (the app syncs text only); a ← previous · Contents · next → line at the end;
     - on the home: book: "Books/<Title (GA n)>", chapters: N, and type, author, translator, ga, image,
       summary where they were missing.
   An EPUB is never kept in the vault: the app asks for one (.hub/requests/, see enricher/epubs.ts), it's
   pushed to a branch of its own, epub/<id>, and the app deletes that branch once the EPUB is saved. That
   works with or without making it a book first.
   `book: failed` with `bookError` says why it didn't work. */
import type { Doc, Index } from "./index.ts";
import { FOLDER, refTarget } from "./vault.ts";

export const isRsarchive = (url?: string) => !!url && /^https?:\/\/(www\.)?rsarchive\.org\//i.test(url);

export interface BookState {
  state?: "pending" | "failed" | "ready";
  /** Books/<Title (GA n)> when ready. */
  folder?: string;
  chapters?: number;
  error?: string;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The book state of a resource's frontmatter. */
export function bookOf(fm: Record<string, unknown>): BookState {
  const b = str(fm.book);
  const out: BookState = { error: str(fm.bookError), chapters: typeof fm.chapters === "number" ? fm.chapters : undefined };
  if (b === "pending" || b === "failed") return { ...out, state: b };
  if (b && b.startsWith(FOLDER.books + "/")) return { ...out, state: "ready", folder: b.replace(/\/+$/, "") };
  return out;
}

export interface ChapterInfo {
  /** The link target of the book's home ("Riddles of Philosophy"). */
  book?: string;
  order: number;
  section?: string;
  date?: string;
  place?: string;
  translator?: string;
  source?: string;
  german?: string;
  summary?: string;
  ga?: string;
}

export function chapterOf(fm: Record<string, unknown>): ChapterInfo {
  const date = fm.date instanceof Date ? fm.date.toISOString().slice(0, 10) : str(fm.date);
  return {
    book: str(fm.book) ? refTarget(str(fm.book)!) : undefined,
    order: typeof fm.order === "number" ? fm.order : Number.MAX_SAFE_INTEGER,
    section: str(fm.section),
    date,
    place: str(fm.place),
    translator: str(fm.translator),
    source: str(fm.source),
    german: str(fm.german),
    summary: str(fm.summary),
    ga: fm.ga == null ? undefined : String(fm.ga),
  };
}

/** A book's chapters, in order. */
export function chaptersIn(ix: Pick<Index, "docs">, folder: string): Doc[] {
  const pre = folder.replace(/\/+$/, "") + "/";
  return [...ix.docs.values()]
    .filter((d) => d.kind === "chapter" && d.path.startsWith(pre))
    .sort((a, b) => (a.chapter?.order ?? 0) - (b.chapter?.order ?? 0) || a.name.localeCompare(b.name));
}

/** Chapters grouped by their section (parts), in order. */
export function sectionsOf(chapters: Doc[]): { heading?: string; chapters: Doc[] }[] {
  const out: { heading?: string; chapters: Doc[] }[] = [];
  for (const c of chapters) {
    const h = c.chapter?.section;
    const last = out.at(-1);
    if (last && last.heading === h) last.chapters.push(c);
    else out.push({ heading: h, chapters: [c] });
  }
  return out;
}

/** The chapter's text for reading in the app: without the date line at the top (the page shows it)
    and the ← previous · Contents · next → line at the end (the page has its own buttons). */
export function readingText(body: string): string {
  return body
    .replace(/^\s*\*[^*\n]+\*\s*\n/, "")
    .replace(/\n-{3,}\s*\n+(?:← )?[^\n]*\|(?:Contents|Inhalt)\]\][^\n]*\s*$/, "\n")
    .trim();
}

/** "[[02 Lecture I#^p12|Lecture I, ¶ 12]]": where a highlight came from, for its comment. */
export function citation(chapter: Pick<Doc, "name" | "title">, block?: string): string {
  const para = block && /^p\d/.test(block) ? `, ¶ ${block.slice(1).replace(/-/g, ".")}` : "";
  return `[[${chapter.name}${block ? `#^${block}` : ""}|${chapter.title.replace(/[|[\]]/g, "")}${para}]]`;
}

/** Text with [[target|alias]] shown as its alias (and [[target]] as its target), for plain-text places. */
export const plainLinks = (s: string) => s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t: string, a?: string) => a ?? t.replace(/#.*$/, ""));
