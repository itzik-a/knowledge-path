/* Import a book or lecture cycle from rsarchive.org for a saved link (`book: pending`): the chapters as
   notes in Books/<Title (GA n)>/, an EPUB for .hub/books/, and what the saved link should say about it.
   The scraping and writing are enricher/rsarchive/ (a copy of github.com/itzik-a/rsarchive-to-epub's
   src/). No text from the site goes to Claude: its robots.txt asks that its content not be used as AI
   input beyond reference (Content-Signal: ai-train=no, use=reference), so the summary is the site's own
   introduction. */
import { FOLDER, HUB } from "../shared/vault.ts";
import { epub } from "./rsarchive/epub.ts";
import { bookFolder, markdown } from "./rsarchive/markdown.ts";
import { allChapters, type Book } from "./rsarchive/model.ts";
import type { Fetcher } from "./rsarchive/net.ts";
import { contents, scrape } from "./rsarchive/scrape.ts";

export interface BookImport {
  book: Book;
  /** Books/<Title (GA n)> */
  folder: string;
  /** Chapter notes by vault path. */
  notes: Map<string, string>;
  epubPath: string;
  epub: Uint8Array;
  /** Pages that couldn't be read (the book is made without them). */
  failed: { url: string; error: string }[];
  /** Frontmatter for the saved link: set where it's missing (`book`, `chapters`, `epub` always). */
  home: { always: Record<string, unknown>; missing: Record<string, unknown> };
}

/** The first paragraph of the edition's introduction (not an epigraph), as plain text, in at most ~300 characters. */
export function summaryOf(descriptionHtml?: string): string | undefined {
  if (!descriptionHtml) return undefined;
  // an epigraph in a blockquote (GA 283 opens with one) is a quotation, not a summary
  const paras = descriptionHtml
    .replace(/<blockquote>[\s\S]*?<\/blockquote>/g, "")
    .split(/<\/p>/)
    .map((p) => p.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 40);
  const first = paras[0];
  if (!first) return undefined;
  if (first.length <= 300) return first;
  const cut = first.slice(0, 300);
  const end = cut.lastIndexOf(". ");
  return end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}

/** The site's own description of itself, which an rsarchive.org page gives as its summary. */
export const GENERIC_SUMMARY = /^Rudolf Steiner Archive: An electronic Library/i;

export async function importBook(url: string, home: string, opts: { fetcher: Fetcher; log?: (m: string) => void }): Promise<BookImport> {
  const c = await contents(url, opts);
  const { book, failed } = await scrape(c, opts);
  const name = bookFolder(book);
  const folder = `${FOLDER.books}/${name}`;
  const notes = new Map<string, string>();
  for (const [p, data] of markdown(book, { home, images: "remote" })) if (typeof data === "string") notes.set(`${FOLDER.books}/${p}`, data);
  const epubPath = `${HUB}/books/${name}.epub`;
  return {
    book,
    folder,
    notes,
    epubPath,
    epub: epub(book),
    failed,
    home: {
      always: { book: folder, chapters: allChapters(book).length, epub: epubPath },
      missing: {
        type: "book",
        author: book.author,
        translator: book.translator,
        ga: book.ga,
        image: book.cover,
        site: "rsarchive.org",
        summary: summaryOf(book.description),
      },
    },
  };
}
