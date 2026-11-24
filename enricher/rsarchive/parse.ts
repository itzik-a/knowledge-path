/* Reading rsarchive.org pages. Everything here is pure (HTML string + its URL in, data out), so it is
   tested against saved pages in tests/fixtures. The site has four kinds of page, all inside
   `#centerPanel .articleBox`:
     - a GA overview for a book (Books/GA018/): one <div><h3><a> per edition, English and German;
     - a GA overview for lectures (Lectures/GA316/): table.gaTable, one numbered row per lecture
       followed by rows for its other translations, with the date, the city and a German link;
     - an edition's contents page: ul/ol.contentList with p.section headings (books), or
       table#contentsTable with td.heading rows, dates and td.summary rows (lectures);
     - a chapter: h2 (book title, GA), p.date, p.translator, div.contentBegins (the text: an h3 title,
       paragraphs with span.paragraphMarker "[ 1 ]", footnotes as sup.footnote > span.footnoteText). */
import { absolute, cleanChildren, parseDoc, text } from "./html.ts";
import type { Footnote, Lang } from "./model.ts";

export type PageKind = "chapter" | "index" | "book-overview" | "lecture-overview" | "not-found" | "unknown";

export function articleBox(doc: Document): Element {
  return doc.querySelector("#centerPanel .articleBox") ?? doc.querySelector(".articleBox") ?? doc.querySelector("main") ?? doc.body;
}

export function pageKind(doc: Document): PageKind {
  const box = articleBox(doc);
  if (/^page not found$/i.test(text(box.querySelector("h2")))) return "not-found";
  if (box.querySelector(".contentBegins")) return "chapter";
  if (box.querySelector("table.gaTable")) return "lecture-overview";
  if (box.querySelector(".contentList, #contentsTable")) return "index";
  if (Array.from(box.querySelectorAll("div > h3 > a[href]")).length) return "book-overview";
  if (box.querySelector(".lectureNav") && box.querySelector("h3")) return "chapter";
  return "unknown";
}

export const langOf = (url: string): Lang => (/\/German\//i.test(url) ? "de" : "en");

/* ---------- headings, dates ---------- */

export interface Heading {
  title: string;
  /** Lines in <small> that aren't the GA number: a subtitle, or "Part I" on a chapter page. */
  extra: string[];
  ga?: string;
}

const GA_RE = /^GA\s*(\d+[a-z]?)$/i;

/** `<h2>Title<br>more<br><small>Subtitle<br><a>GA 316</a></small></h2>` → its parts. */
export function parseHeading(h2: Element | null, fallbackTitle = ""): Heading {
  if (!h2) return { title: fallbackTitle, extra: [] };
  const titleParts: string[] = [];
  const extra: string[] = [];
  let ga: string | undefined;
  const takeLines = (el: Element) => {
    let line = "";
    const flush = () => {
      const t = line.replace(/\s+/g, " ").trim();
      line = "";
      if (!t) return;
      const m = GA_RE.exec(t);
      if (m) ga = m[1].toLowerCase();
      else extra.push(t);
    };
    const walk = (n: Node) => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType === 1 && (c as Element).tagName === "BR") flush();
        else if (c.nodeType === 1) walk(c);
        else if (c.nodeType === 3) line += c.nodeValue;
      }
    };
    walk(el);
    flush();
  };
  for (const c of Array.from(h2.childNodes)) {
    if (c.nodeType === 1 && (c as Element).tagName === "SMALL") takeLines(c as Element);
    else if (c.nodeType === 1 && (c as Element).tagName === "BR") titleParts.push(" ");
    else titleParts.push(c.textContent ?? "");
  }
  let title = titleParts.join("").replace(/\s+/g, " ").trim();
  const inline = /^(.*?)\s*[—–-]?\s*GA\s*(\d+[a-z]?)$/i.exec(title);
  if (inline && inline[1]) {
    title = inline[1];
    ga ??= inline[2].toLowerCase();
  }
  return { title: title || fallbackTitle, extra, ga };
}

/** "GA18 The Riddles of Philosophy (overview) - Rudolf Steiner Archive" → "The Riddles of Philosophy". */
export function titleFromTitleTag(doc: Document): string {
  return text(doc.querySelector("title"))
    .replace(/\s*-\s*Rudolf Steiner Archive\s*$/i, "")
    .replace(/^GA\s*\d+[a-z]?\s*/i, "")
    .replace(/\s*\((overview|index)\)\s*$/i, "")
    .trim();
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  januar: 1, februar: 2, märz: 3, maerz: 3, mai: 5, juni: 6, juli: 7, oktober: 10, dezember: 12,
};

const iso = (y: string, m: number, d: string) => `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`;

/** "3 December 1906", "2. Januar 1924", "December 03, 1906", "2 Jan 1924" → "1906-12-03". */
export function parseDate(s: string): { date: string; rest: string } | undefined {
  let m = /(\d{1,2})\.?\s+([A-Za-zäÄ]+)\.?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return { date: iso(m[3], MONTHS[m[2].toLowerCase()], m[1]), rest: s.slice(m.index + m[0].length) };
  m = /([A-Za-zäÄ]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return { date: iso(m[3], MONTHS[m[1].toLowerCase()], m[2]), rest: s.slice(m.index + m[0].length) };
  return undefined;
}

/** "3 December 1906, Cologne" → date and place. */
export function parseDateLine(line: string): { date?: string; place?: string } {
  const d = parseDate(line);
  if (!d) return {};
  const place = d.rest.replace(/^[\s,.;:–—-]+/, "").trim();
  return { date: d.date, place: place || undefined };
}

/** "PART I" → "Part I", "THE EASTER COURSE" → "The Easter Course"; mixed case is left alone. */
export function tidyHeading(s: string): string {
  if (/\p{Ll}/u.test(s) || !/\p{Lu}{2}/u.test(s)) return s;
  const small = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "und", "der", "die", "das"]);
  return s
    .split(/(\s+)/)
    .map((w, i) => {
      if (/^\s+$/.test(w) || /^[IVXLCDM]+[.:]?$/.test(w)) return w;
      const lower = w.toLowerCase();
      return i > 0 && small.has(lower) ? lower : lower.replace(/^(\P{L}*)(\p{L})/u, (_, pre: string, c: string) => pre + c.toUpperCase());
    })
    .join("");
}

/* ---------- GA overview: books ---------- */

export interface Edition {
  title: string;
  url: string;
  lang: Lang;
  /** The publication line under it: publisher, year, translator. */
  note?: string;
}

export interface BookOverview {
  title: string;
  ga?: string;
  editions: Edition[];
}

export function parseBookOverview(html: string, url: string): BookOverview {
  const doc = parseDoc(html);
  const box = articleBox(doc);
  const h = parseHeading(box.querySelector("h2"), titleFromTitleTag(doc));
  const editions: Edition[] = [];
  for (const a of Array.from(box.querySelectorAll("div > h3 > a[href]"))) {
    const href = absolute(a.getAttribute("href") ?? "", url);
    if (!href || editions.some((e) => e.url === href)) continue;
    const div = a.closest("div");
    const note = text(div?.querySelector("p")) || undefined;
    editions.push({ title: text(a), url: href, lang: langOf(href), note });
  }
  return { title: h.title, ga: h.ga, editions };
}

/* ---------- GA overview: lectures ---------- */

export interface Translation {
  label: string;
  url: string;
  /** The edition or cycle it belongs to, and its contents page. */
  edition?: string;
  editionUrl?: string;
  translator?: string;
}

export interface OverviewLecture {
  n: number;
  dateText?: string;
  date?: string;
  place?: string;
  germanUrl?: string;
  translations: Translation[];
}

export interface LectureOverview {
  title: string;
  subtitle?: string;
  ga?: string;
  lectures: OverviewLecture[];
}

export function parseLectureOverview(html: string, url: string): LectureOverview {
  const doc = parseDoc(html);
  const box = articleBox(doc);
  const h = parseHeading(box.querySelector("h2"), titleFromTitleTag(doc));
  const lectures: OverviewLecture[] = [];
  for (const tr of Array.from(box.querySelectorAll("table.gaTable tr"))) {
    const tds = Array.from(tr.querySelectorAll("td"));
    if (tds.length < 2) continue;
    const num = /^(\d+)\.?$/.exec(text(tds[0]));
    let lecture = lectures.at(-1);
    if (num || !lecture) {
      const dateCell = tds[3];
      const dateText = dateCell ? text(dateCell.firstChild) || undefined : undefined;
      const german = dateCell?.querySelector("a[href]")?.getAttribute("href");
      lecture = {
        n: num ? Number(num[1]) : lectures.length + 1,
        dateText,
        date: dateText ? parseDate(dateText)?.date : undefined,
        place: text(tds[4]) || undefined,
        germanUrl: german ? (absolute(german, url) ?? undefined) : undefined,
        translations: [],
      };
      lectures.push(lecture);
    }
    const a = tds[1].querySelector("a[href]");
    const href = a ? absolute(a.getAttribute("href") ?? "", url) : null;
    if (!a || !href) continue;
    const ed = tds[2]?.querySelector("a[href]");
    lecture.translations.push({
      label: text(a),
      url: href,
      edition: ed ? text(ed) : undefined,
      editionUrl: ed ? (absolute(ed.getAttribute("href") ?? "", url) ?? undefined) : undefined,
      translator: text(tds[2]?.querySelector("small")) || undefined,
    });
  }
  return { title: h.title, subtitle: h.extra[0], ga: h.ga, lectures };
}

/* ---------- an edition's contents page ---------- */

export interface IndexEntry {
  section?: string;
  label: string;
  url: string;
  date?: string;
  summary?: string;
}

export interface IndexPage {
  title: string;
  subtitle?: string;
  ga?: string;
  lang: Lang;
  /** Clean HTML of the introduction (the blockquote above the contents). */
  description?: string;
  cover?: string;
  entries: IndexEntry[];
}

export function parseIndex(html: string, url: string): IndexPage {
  const doc = parseDoc(html);
  const box = articleBox(doc);
  const h = parseHeading(box.querySelector("h2"), titleFromTitleTag(doc));

  // The introduction: blockquote.summary (GA018 spells it `clas="summary"`, so any top blockquote).
  const intro = box.querySelector("blockquote.summary") ?? Array.from(box.children).find((c) => c.tagName === "BLOCKQUOTE") ?? null;
  const coverImg = (intro ?? box).querySelector("img.bookImage, img.bookImageGA");
  const cover = coverImg ? (absolute(coverImg.getAttribute("src") ?? "", url) ?? undefined) : undefined;
  coverImg?.remove();
  const description = intro ? cleanChildren(intro, { base: url }).trim() || undefined : undefined;

  const entries: IndexEntry[] = [];
  const seen = new Set<string>();
  let section: string | undefined;
  const page = url.split("#")[0];
  for (const el of Array.from(box.querySelectorAll("p.section, td.heading, .contentList a[href], #contentsTable a[href], #contentsTable td.summary"))) {
    if (el.matches("p.section, td.heading")) {
      section = tidyHeading(text(el)) || undefined;
      continue;
    }
    if (el.matches("td.summary")) {
      const last = entries.at(-1);
      if (last && !last.summary) last.summary = text(el) || undefined;
      continue;
    }
    const href = absolute(el.getAttribute("href") ?? "", url);
    if (!href || !/\.html?($|[?#])/i.test(href)) continue;
    const clean = href.split("#")[0];
    if (clean === page || seen.has(clean)) continue;
    seen.add(clean);
    let date: string | undefined;
    const tr = el.closest("tr");
    if (tr) {
      for (const td of Array.from(tr.querySelectorAll("td")).reverse()) {
        const d = parseDate(text(td));
        if (d) {
          date = d.date;
          break;
        }
      }
    }
    entries.push({ section, label: text(el), url: clean, date });
  }

  // Unknown layout: every .html link in the box outside the navigation, in the same folder.
  if (!entries.length) {
    const dir = page.replace(/[^/]*$/, "");
    for (const a of Array.from(box.querySelectorAll("a[href]"))) {
      if (a.closest(".lectureNav")) continue;
      const href = absolute(a.getAttribute("href") ?? "", url)?.split("#")[0];
      if (!href || !href.startsWith(dir) || href === page || !/\.html?$/i.test(href) || seen.has(href)) continue;
      seen.add(href);
      entries.push({ label: text(a) || href.split("/").pop()!, url: href });
    }
  }

  return { title: h.title, subtitle: h.extra[0], ga: h.ga, lang: langOf(url), description, cover, entries };
}

/* ---------- a chapter ---------- */

export interface ChapterPage {
  bookTitle: string;
  ga?: string;
  /** "Part I" from the heading, when the page has one. */
  part?: string;
  title?: string;
  dateLine?: string;
  date?: string;
  place?: string;
  translator?: string;
  tocUrl?: string;
  html: string;
  footnotes: Footnote[];
  images: string[];
}

export function parseChapter(html: string, url: string): ChapterPage {
  const doc = parseDoc(html);
  const box = articleBox(doc);
  const h = parseHeading(box.querySelector("h2"), titleFromTitleTag(doc));

  const dateLine = text(box.querySelector("p.date")) || undefined;
  const translator = text(box.querySelector("p.translator")).replace(/^translated\s+(from the german\s+)?by\s*/i, "") || undefined;
  const tocLink = Array.from(box.querySelectorAll(".lectureNav a[href]")).find((a) => /table of contents|inhalt/i.test(text(a)));
  const tocUrl = tocLink ? (absolute(tocLink.getAttribute("href") ?? "", url) ?? undefined) : undefined;

  let content = box.querySelector(".contentBegins");
  if (!content) {
    // Older layout: the text follows the heading directly in the article box.
    content = box;
    for (const el of Array.from(box.querySelectorAll(".lectureNav, h2, p.date, p.translator, #compare, a:has(> button)"))) el.remove();
  }

  // The chapter's title is its first heading, when it comes before the text.
  let title: string | undefined;
  const first = Array.from(content.children).find((c) => /^(H[1-6]|P|DIV|BLOCKQUOTE)$/.test(c.tagName));
  if (first && /^H[3-4]$/.test(first.tagName)) {
    title = text(first) || undefined;
    first.remove();
  }

  // Paragraph numbers: <span class="paragraphMarker">[ 12 ] </span> → <p id="p-12"><span class="pn">12</span>.
  const ids = new Set<string>();
  for (const span of Array.from(content.querySelectorAll("span.paragraphMarker"))) {
    const n = /\[\s*([\w.]+)\s*\]/.exec(span.textContent ?? "")?.[1];
    if (!n) {
      span.remove();
      continue;
    }
    const pn = doc.createElement("span");
    pn.setAttribute("class", "pn");
    pn.textContent = n;
    const after = span.nextSibling;
    if (after?.nodeType === 3) after.nodeValue = (after.nodeValue ?? "").replace(/^\s+/, "");
    span.replaceWith(pn, doc.createTextNode(" "));
    const p = pn.closest("p");
    let id = `p-${n}`;
    for (let i = 2; ids.has(id); i++) id = `p-${n}-${i}`;
    if (p && !p.getAttribute("id")) {
      p.setAttribute("id", id);
      ids.add(id);
    }
  }

  // Footnotes: <sup class="footnote">1<span class="footnoteText">…</span></sup> → a reference here, the text in `footnotes`.
  const footnotes: Footnote[] = [];
  for (const sup of Array.from(content.querySelectorAll("sup.footnote"))) {
    const body = sup.querySelector(".footnoteText");
    const shown = Array.from(sup.childNodes).filter((c) => c !== body).map((c) => c.textContent ?? "").join("").trim();
    const key = String(footnotes.length + 1);
    footnotes.push({ key, n: shown || key, html: body ? cleanChildren(body, { base: url }).trim() : "" });
    const ref = doc.createElement("sup");
    ref.setAttribute("class", "fnref");
    const a = doc.createElement("a");
    a.setAttribute("href", `#fn-${key}`);
    a.setAttribute("id", `fnref-${key}`);
    a.textContent = shown || key;
    ref.appendChild(a);
    sup.replaceWith(ref);
  }

  // A diagram standing between paragraphs becomes a figure, so readers centre it.
  for (const img of Array.from(content.querySelectorAll("img"))) {
    if (img.parentNode !== content) continue;
    const fig = doc.createElement("figure");
    img.replaceWith(fig);
    fig.appendChild(img);
  }

  const images: string[] = [];
  const clean = cleanChildren(content, { base: url, onImage: (src) => images.includes(src) || images.push(src) }).trim();
  return {
    bookTitle: h.title,
    ga: h.ga,
    part: h.extra.find((e) => /^(part|teil)\b/i.test(e)),
    title,
    dateLine,
    ...(dateLine ? parseDateLine(dateLine) : {}),
    translator,
    tocUrl,
    html: clean,
    footnotes,
    images,
  };
}

/** Which kind of page this HTML is. */
export const kindOf = (html: string) => pageKind(parseDoc(html));
