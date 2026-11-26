/* PDFs in the vault (DOM- and Node-free). The file is `PDFs/<name>.pdf` (committed when it's under PDF_LIMIT,
   else kept only on the device that added it); its page in the app is a saved link (a resource) in Resources/
   with `pdf: "[[PDFs/<name>.pdf]]"` (and `pdfLocal: true` when it's too big for the vault), so status, topics,
   notes and highlights work as for any saved link, and Obsidian follows the link. A highlight made in the
   reader has the page as its comment, an Obsidian link: `[[PDFs/<name>.pdf#page=12|p. 12]]`. */
import { safeName } from "./vault.ts";

export const PDF_FOLDER = "PDFs";
/** Bigger PDFs stay on the device they were added on (GitHub refuses files over 100 MB; the vault stays small). */
export const PDF_LIMIT = 20 * 1024 * 1024;

export const isPdfPath = (p: string) => /\.pdf$/i.test(p);

/** A resource's PDF path, from `pdf: "[[PDFs/x.pdf]]"` (or a bare path). */
export function pdfOf(fm: Record<string, unknown>): string | undefined {
  const v = fm.pdf;
  if (typeof v !== "string") return undefined;
  const p = v.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0].trim();
  return isPdfPath(p) ? p : undefined;
}

export const pdfLink = (path: string) => `[[${path}]]`;

/** The vault path for a new PDF named `title`. */
export function pdfPathFor(title: string, taken: (p: string) => boolean): string {
  const name = safeName(title.replace(/\.pdf$/i, "")) || "Document";
  let p = `${PDF_FOLDER}/${name}.pdf`;
  for (let i = 2; taken(p); i++) p = `${PDF_FOLDER}/${name} ${i}.pdf`;
  return p;
}

/** A highlight's comment linking to a page. */
export const pageLink = (pdf: string, page: number) => `[[${pdf}#page=${page}|p. ${page}]]`;

/** The page a highlight's comment links to (`#page=12`), if any. */
export function pageOf(comment: string | undefined): number | undefined {
  const m = comment && /\.pdf#page=(\d+)/i.exec(comment);
  return m ? Number(m[1]) : undefined;
}

/** Text selected in a PDF, tidied: words broken at a line end joined, lines and spaces folded. */
export function cleanSelection(s: string): string {
  return s.replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, "$1$2").replace(/\s+/g, " ").trim();
}

const fold = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** The part of each text piece a highlight covers, as character ranges in the piece ([from, to)), compared
    without spaces so line breaks don't matter; [] when the quote isn't on the page. */
export function rangesFor(pieces: string[], quote: string): { i: number; from: number; to: number }[] {
  const q = fold(cleanSelection(quote.replace(/==/g, "")));
  if (q.length < 3) return [];
  // every non-space character of the page, with where it is
  const at: { i: number; c: number }[] = [];
  let all = "";
  pieces.forEach((p, i) => { for (let c = 0; c < p.length; c++) if (!/\s/.test(p[c])) { all += p[c].toLowerCase(); at.push({ i, c }); } });
  const k = all.indexOf(q);
  if (k < 0) return [];
  const out: { i: number; from: number; to: number }[] = [];
  for (let j = k; j < k + q.length; j++) {
    const { i, c } = at[j];
    const last = out[out.length - 1];
    if (last && last.i === i) last.to = c + 1; else out.push({ i, from: c, to: c + 1 });
  }
  return out;
}

/** Which pieces a highlight touches (any part of them). */
export const piecesFor = (pieces: string[], quote: string) => rangesFor(pieces, quote).map((r) => r.i);
