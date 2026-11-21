/* What can be read from a saved link: title, author, site, image, year, and the article's readable text
   as Markdown (Mozilla Readability on a linkedom DOM, then Turndown). YouTube pages give the video
   description; PDFs and pages that won't load give what the URL says. */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { decodeEntities, getText, isHttpUrl } from "./net.ts";

export interface Page {
  url: string;
  title?: string;
  author?: string;
  site?: string;
  image?: string;
  year?: string;
  description?: string;
  /** The article as Markdown, when the page had a readable article. */
  markdown?: string;
  /** Plain text for the summary (article, or description). */
  text: string;
}

export const MAX_TEXT_CHARS = 40_000;

const meta = (doc: Document, ...keys: string[]) => {
  for (const k of keys) {
    const v = doc.querySelector(`meta[property="${k}"], meta[name="${k}"], meta[itemprop="${k}"]`)?.getAttribute("content")?.trim();
    if (v) return decodeEntities(v);
  }
  return "";
};

const tidy = (s: string) => s.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
td.remove(["script", "style", "iframe", "form", "button", "noscript"] as never);

/** "Stoicism – Wikipedia" → "Stoicism": drop a short trailing site name. */
export function cleanTitle(title: string, site?: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  const m = /^(.{2,}?)\s+[-–—|·:]\s+([^-–—|·]{2,40})$/.exec(t);
  if (!m) return t;
  const tail = m[2].toLowerCase();
  const s = (site ?? "").toLowerCase().replace(/^www\./, "");
  const known = /wikipedia|ויקיפדיה|youtube|medium|substack|the guardian|bbc|nytimes|new york times|aeon|stanford encyclopedia/i.test(tail);
  const siteWord = s && (tail.includes(s.split(".")[0]) || s.includes(tail.replace(/\s+/g, "")));
  return known || siteWord ? m[1].trim() : t;
}

/** A one-line fallback summary from a page description (used when Claude isn't set up). */
export function shortDescription(d?: string): string | undefined {
  const first = (d ?? "").split(/\n\s*\n/)[0].replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (first.length < 20) return undefined;
  return first.length > 240 ? first.slice(0, 239).replace(/\s+\S*$/, "") + "…" : first;
}

const yearOf = (s: string) => /\b(1[5-9]\d\d|20\d\d)\b/.exec(s)?.[1];

export async function readPage(url: string): Promise<Page> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (/\.pdf($|\?)/i.test(url)) return { url, site: host, text: "" };

  const page = await getText(url);
  if (!/html|xml/i.test(page.type) && page.type) return { url: page.url, site: host, text: "" };
  const { document } = parseHTML(page.text) as unknown as { document: Document };

  const title = meta(document, "og:title", "twitter:title") || decodeEntities(document.title || "").trim();
  const description = meta(document, "og:description", "description", "twitter:description");
  const ogImage = meta(document, "og:image", "twitter:image");
  const image = isHttpUrl(ogImage) ? ogImage : undefined;
  const site = meta(document, "og:site_name") || host;
  const published = meta(document, "article:published_time", "datePublished", "date", "dc.date");
  const author = meta(document, "author", "article:author", "dc.creator", "parsely-author");

  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) {
    const m = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(page.text);
    let desc = description;
    if (m) { try { desc = JSON.parse(`"${m[1]}"`) as string; } catch { /* keep og */ } }
    const channel = /"ownerChannelName":"((?:[^"\\]|\\.)*)"/.exec(page.text)?.[1] ?? /"author":"((?:[^"\\]|\\.)*)"/.exec(page.text)?.[1];
    const date = /"publishDate":"(\d{4})/.exec(page.text)?.[1];
    return { url: page.url, title: cleanTitle(title, "youtube"), author: channel, site: "YouTube", image, year: date, description: desc, text: tidy(desc).slice(0, MAX_TEXT_CHARS) };
  }

  let article: { title?: string | null; byline?: string | null; content?: string | null; textContent?: string | null } | null = null;
  try { article = new Readability(document.cloneNode(true) as Document, { charThreshold: 500 }).parse(); } catch { /* not an article */ }
  const text = tidy(article?.textContent ?? "");
  const isArticle = text.length >= 800 && !!article?.content;
  let markdown: string | undefined;
  if (isArticle) {
    try { markdown = td.turndown(article!.content!).replace(/\n{3,}/g, "\n\n").trim(); } catch { markdown = text; }
  }
  return {
    url: page.url,
    title: cleanTitle(title || article?.title || "", site) || undefined,
    author: author && !/^https?:/.test(author) ? author : article?.byline?.replace(/^by\s+/i, "").trim() || undefined,
    site, image, year: yearOf(published), description,
    markdown,
    text: (isArticle ? text : description || text).slice(0, MAX_TEXT_CHARS),
  };
}
