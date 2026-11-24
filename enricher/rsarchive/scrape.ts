/* From a URL to a Book, in two steps: `contents()` works out what the book is and which pages it is
   made of (a page or two: enough for --list), then `scrape()` fetches the chapters and images.
   Any rsarchive.org page will do as the start: a GA overview (choose the edition / translation),
   an edition's contents page, or a chapter (its "Table of Contents" link is followed). */
import { HttpError, decodeHtml, type Fetcher } from "./net.ts";
import type { Book, Chapter, Image, Lang, Section } from "./model.ts";
import { parseDoc } from "./html.ts";
import {
  pageKind,
  parseBookOverview,
  parseChapter,
  parseIndex,
  parseLectureOverview,
  type ChapterPage,
  type Translation,
} from "./parse.ts";

export interface ContentsEntry {
  section?: string;
  label: string;
  url: string;
  date?: string;
  place?: string;
  summary?: string;
  germanUrl?: string;
}

export interface Contents {
  sourceUrl: string;
  title: string;
  subtitle?: string;
  ga?: string;
  lang: Lang;
  description?: string;
  cover?: string;
  /** The edition's publication line, from a GA overview. */
  edition?: string;
  entries: ContentsEntry[];
  /** What else could be chosen on the overview this came from (shown by --list). */
  choices?: Choice[];
}

export interface Choice {
  label: string;
  /** How to pick it: an --edition number or a --translation text. */
  pick: string;
  chosen: boolean;
  url?: string;
  count?: number;
}

export interface ScrapeOptions {
  fetcher: Fetcher;
  /** Language on a GA overview; default English. */
  lang?: Lang;
  /** On a book's GA overview, which edition in that language (1 = first). */
  edition?: number;
  /** On a lecture GA overview, prefer translations whose translator, edition or folder contains this. */
  translation?: string;
  /** Only the chapter given, not its whole book. */
  single?: boolean;
  log?: (msg: string) => void;
}

export class ScrapeError extends Error {}

async function page(url: string, fetcher: Fetcher): Promise<{ url: string; html: string }> {
  const got = await fetcher.get(url);
  return { url: got.url, html: decodeHtml(got) };
}

const sameTitle = (a: string, b: string) => a.replace(/^the\s+/i, "").toLowerCase() === b.replace(/^the\s+/i, "").toLowerCase();

export async function contents(startUrl: string, opts: ScrapeOptions, depth = 0): Promise<Contents> {
  if (depth > 3) throw new ScrapeError(`Too many hops from ${startUrl}`);
  const { url, html } = await page(startUrl, opts.fetcher);
  const kind = pageKind(parseDoc(html));
  const lang = opts.lang ?? "en";

  switch (kind) {
    case "not-found":
      throw new ScrapeError(`rsarchive.org says this page doesn't exist: ${url}`);

    case "chapter": {
      const ch = parseChapter(html, url);
      if (!opts.single && ch.tocUrl && ch.tocUrl !== url) {
        opts.log?.(`Following its table of contents: ${ch.tocUrl}`);
        try {
          const c = await contents(ch.tocUrl, { ...opts, lang: opts.lang ?? (url.includes("/German/") ? "de" : "en") }, depth + 1);
          if (c.entries.some((e) => e.url === url)) return c;
          opts.log?.("  that contents page doesn't list this chapter, so making a book of this chapter alone");
        } catch (e) {
          if (!(e instanceof HttpError) && !(e instanceof ScrapeError)) throw e;
          opts.log?.(`  couldn't use it (${e.message}); making a book of this chapter alone`);
        }
      }
      return {
        sourceUrl: url,
        title: ch.title ? `${ch.bookTitle}: ${ch.title}` : ch.bookTitle,
        ga: ch.ga,
        lang: url.includes("/German/") ? "de" : "en",
        entries: [{ label: ch.title ?? ch.bookTitle, url, date: ch.date, place: ch.place }],
      };
    }

    case "index": {
      const ix = parseIndex(html, url);
      if (!ix.entries.length) throw new ScrapeError(`No chapters found on ${url}`);
      return {
        sourceUrl: url,
        title: ix.title,
        subtitle: ix.subtitle,
        ga: ix.ga,
        lang: ix.lang,
        description: ix.description,
        cover: ix.cover,
        entries: ix.entries.map((e) => ({ section: e.section, label: e.label, url: e.url, date: e.date, summary: e.summary })),
      };
    }

    case "book-overview": {
      const ov = parseBookOverview(html, url);
      const inLang = ov.editions.filter((e) => e.lang === lang);
      const n = opts.edition ?? 1;
      const ed = inLang[n - 1];
      const choices = inLang.map((e, i) => ({ label: e.note ? `${e.title} — ${e.note}` : e.title, pick: `--edition ${i + 1}`, chosen: i === n - 1, url: e.url }));
      if (!ed) {
        const list = ov.editions.map((e) => `  ${e.lang}  ${e.title}  ${e.url}`).join("\n");
        throw new ScrapeError(`No ${lang === "de" ? "German" : "English"} edition number ${n} on ${url}. Editions there:\n${list}`);
      }
      opts.log?.(`Edition: ${ed.title}`);
      const c = await contents(ed.url, { ...opts, lang }, depth + 1);
      return {
        ...c,
        title: sameTitle(ov.title, c.title) ? ov.title : c.title,
        ga: c.ga ?? ov.ga,
        edition: ed.note,
        choices: choices.length > 1 ? choices : undefined,
      };
    }

    case "lecture-overview": {
      const ov = parseLectureOverview(html, url);
      const want = opts.translation?.toLowerCase();
      const matches = (t: Translation) => !!want && [t.translator, t.edition, t.url, t.label].some((s) => s?.toLowerCase().includes(want));
      const entries: ContentsEntry[] = [];
      const chosenEditions: (string | undefined)[] = [];
      for (const lec of ov.lectures) {
        if (lang === "de") {
          if (!lec.germanUrl) continue;
          entries.push({ label: `${lec.n}. ${lec.dateText ?? ""}`.trim(), url: lec.germanUrl, date: lec.date, place: lec.place });
          continue;
        }
        const t = lec.translations.find(matches) ?? lec.translations[0];
        if (!t) {
          opts.log?.(`  lecture ${lec.n} (${lec.dateText ?? "no date"}) has no English translation; left out`);
          continue;
        }
        chosenEditions.push(t.edition);
        entries.push({ label: t.label, url: t.url, date: lec.date, place: lec.place, germanUrl: lec.germanUrl, section: t.edition });
      }
      if (!entries.length) throw new ScrapeError(`No ${lang === "de" ? "German" : "English"} lectures listed on ${url}`);
      // Name sections after the edition only when the chosen lectures come from more than one.
      if (new Set(chosenEditions).size <= 1) for (const e of entries) delete e.section;

      // Every translation offered (grouped by edition), with how many lectures it covers and a
      // --translation value that picks all of them: the translator if every row names one, else the folder.
      const groups = new Map<string, Translation[]>();
      const folderOf = (t: Translation) => /\/English\/([^/]+)\//.exec(t.url)?.[1] ?? t.url.split("/").slice(-2, -1)[0];
      for (const lec of ov.lectures) {
        for (const t of lec.translations) {
          const key = t.editionUrl ?? folderOf(t);
          groups.set(key, [...(groups.get(key) ?? []), t]);
        }
      }
      const choices: Choice[] = [...groups.values()].map((ts) => {
        const translator = ts.find((t) => t.translator)?.translator;
        const folder = folderOf(ts[0]);
        const pick = translator && ts.every((t) => t.translator === translator) ? translator : folder;
        return {
          label: [ts[0].edition, translator].filter(Boolean).join(", tr. ") || ts[0].url,
          pick: `--translation "${pick}"`,
          chosen: ts.some((t) => entries.some((e) => e.url === t.url)),
          url: ts[0].editionUrl,
          count: ts.length,
        };
      });

      // A cover and introduction from the edition most of the chosen lectures come from, if it has a contents page.
      let extra: Partial<Contents> = {};
      const edCount = new Map<string, number>();
      for (const l of ov.lectures) {
        const u = (l.translations.find(matches) ?? l.translations[0])?.editionUrl;
        if (u) edCount.set(u, (edCount.get(u) ?? 0) + 1);
      }
      const [mainEd, mainCount = 0] = [...edCount].sort((a, b) => b[1] - a[1])[0] ?? [];
      if (lang === "en" && mainEd && mainCount > entries.length / 2) {
        try {
          const ed = await page(mainEd, opts.fetcher);
          if (pageKind(parseDoc(ed.html)) === "index") {
            const ix = parseIndex(ed.html, ed.url);
            extra = { cover: ix.cover, description: ix.description };
          }
        } catch {
          /* no contents page for that edition: fine */
        }
      }
      return {
        sourceUrl: url,
        title: ov.title,
        subtitle: ov.subtitle,
        ga: ov.ga,
        lang,
        ...extra,
        entries,
        choices: choices.length > 1 ? choices : undefined,
      };
    }

    default:
      throw new ScrapeError(`This doesn't look like a book, lecture cycle or chapter on rsarchive.org: ${url}`);
  }
}

export interface Scraped {
  book: Book;
  failed: { url: string; error: string }[];
}

export async function scrape(c: Contents, opts: ScrapeOptions): Promise<Scraped> {
  const failed: Scraped["failed"] = [];
  const sections: Section[] = [];
  const n = c.entries.length;

  for (const [i, entry] of c.entries.entries()) {
    opts.log?.(`[${i + 1}/${n}] ${entry.label}`);
    let ch: ChapterPage;
    try {
      const { url, html } = await page(entry.url, opts.fetcher);
      if (pageKind(parseDoc(html)) !== "chapter") throw new ScrapeError("not a chapter page");
      ch = parseChapter(html, url);
      if (!ch.html) throw new ScrapeError("no text on the page");
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      opts.log?.(`  !! skipped: ${error}`);
      failed.push({ url: entry.url, error });
      continue;
    }
    const chapter: Chapter = {
      url: entry.url,
      title: ch.title ?? entry.label,
      label: entry.label,
      dateLine: ch.dateLine,
      date: ch.date ?? entry.date,
      place: ch.place ?? entry.place,
      translator: ch.translator,
      summary: entry.summary,
      germanUrl: entry.germanUrl,
      html: ch.html,
      footnotes: ch.footnotes,
      images: ch.images,
    };
    const last = sections.at(-1);
    if (last && last.heading === entry.section) last.chapters.push(chapter);
    else sections.push({ heading: entry.section, chapters: [chapter] });
  }

  const chapters = sections.flatMap((s) => s.chapters);
  if (!chapters.length) throw new ScrapeError("No chapter could be read.");
  const translators = new Set(chapters.map((ch) => ch.translator).filter(Boolean));

  const images = new Map<string, Image>();
  const wanted = [...new Set([...(c.cover ? [c.cover] : []), ...chapters.flatMap((ch) => ch.images)])];
  for (const [i, url] of wanted.entries()) {
    opts.log?.(`image ${i + 1}/${wanted.length}: ${url.split("/").pop()}`);
    try {
      const got = await opts.fetcher.get(url, { referer: c.sourceUrl });
      const type = imageType(got.type, url, got.data);
      if (!type) throw new ScrapeError(`not an image (${got.type || "no type"})`);
      images.set(url, { url, type, data: got.data });
    } catch (e) {
      opts.log?.(`  !! image left out: ${e instanceof Error ? e.message : e}`);
    }
  }

  const book: Book = {
    title: c.title,
    subtitle: c.subtitle,
    ga: c.ga,
    lang: c.lang,
    author: "Rudolf Steiner",
    translator: translators.size === 1 ? [...translators][0] : undefined,
    description: c.description,
    cover: c.cover && images.has(c.cover) ? c.cover : undefined,
    edition: c.edition,
    sourceUrl: c.sourceUrl,
    sections,
    images,
  };
  return { book, failed };
}

const SNIFF: [string, number[]][] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
];
const BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/** The image's media type, from its bytes first (servers mislabel), then the header, then the name. */
export function imageType(header: string, url: string, data: Uint8Array): string | undefined {
  for (const [type, magic] of SNIFF) if (magic.every((b, i) => data[i] === b)) return type;
  if (data.length > 12 && String.fromCharCode(...data.subarray(0, 4)) === "RIFF" && String.fromCharCode(...data.subarray(8, 12)) === "WEBP") return "image/webp";
  const h = header.split(";")[0].trim().toLowerCase();
  if (h.startsWith("image/")) return h;
  const ext = /\.(\w+)(?:$|\?)/.exec(url)?.[1]?.toLowerCase();
  return ext ? BY_EXT[ext] : undefined;
}
