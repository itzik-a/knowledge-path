/* The book in between: what the scraper produces and every writer (EPUB, Markdown) reads.
   Chapter text is "clean HTML": a small, safe subset made by html.ts, with absolute URLs, paragraph
   numbers as <p id="p-N"><span class="pn">N</span> …, and footnote references as
   <sup class="fnref"><a href="#fn-K" id="fnref-K">N</a></sup> pointing into `footnotes`. */

export type Lang = "en" | "de";

export interface Book {
  title: string;
  subtitle?: string;
  /** Gesamtausgabe volume, as written: "18", "93a". */
  ga?: string;
  lang: Lang;
  author: string;
  /** The translator when one is named for the whole book (else per chapter). */
  translator?: string;
  /** Clean HTML: the edition's introduction from its contents page. */
  description?: string;
  /** The edition's publication line ("Anthroposophic Press, 1973, translated by …"), when known. */
  edition?: string;
  /** Absolute URL of the cover image. */
  cover?: string;
  /** The page the book was made from. */
  sourceUrl: string;
  sections: Section[];
  /** Images by absolute URL: the cover and those in chapters, as downloaded. */
  images: Map<string, Image>;
}

export interface Section {
  /** "Part I", "Christmas Course"; none for a book without parts. */
  heading?: string;
  chapters: Chapter[];
}

export interface Chapter {
  url: string;
  title: string;
  /** The contents page's label when it adds something ("Lecture I"). */
  label?: string;
  /** As the page writes it: "3 December 1906, Cologne". */
  dateLine?: string;
  /** ISO date, when the date line or the contents page has one. */
  date?: string;
  place?: string;
  translator?: string;
  /** The contents page's summary of the chapter, plain text. */
  summary?: string;
  /** The German original's page, when known. */
  germanUrl?: string;
  html: string;
  footnotes: Footnote[];
  /** Absolute URLs of the images in `html`, in order. */
  images: string[];
}

export interface Footnote {
  /** Its id in the chapter: fn-<key>. */
  key: string;
  /** The number the page shows. */
  n: string;
  html: string;
}

export interface Image {
  url: string;
  type: string;
  data: Uint8Array;
}

export const allChapters = (book: Book) => book.sections.flatMap((s) => s.chapters);

/** "Lecture I", "The Inner Nature of Music I" → "Lecture I: The Inner Nature of Music I";
    a label the title already says is left out. */
export function displayTitle(ch: Pick<Chapter, "title" | "label">): string {
  if (!ch.label) return ch.title;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const t = norm(ch.title);
  const l = norm(ch.label);
  if (!l || t.includes(l)) return ch.title;
  if (l.includes(t)) return ch.label;
  return `${ch.label}: ${ch.title}`;
}
