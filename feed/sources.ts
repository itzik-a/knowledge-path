/* Finding a source's feed, and reading new items out of it (RSS 2.0, Atom, RSS 1.0 / RDF, YouTube, Google News). */
import { XMLParser } from "fast-xml-parser";
import type { Edition, PendingItem, Source } from "../shared/feed.ts";
import { canonicalUrl, getText, hash, isHttpUrl, stripHtml } from "./net.ts";

/** An item as read, plus what only lives for one run. */
export interface RawItem extends PendingItem {
  /** the whole article when the feed carries it (content:encoded), so the page needn't be fetched */
  fullText?: string;
}

const EDITIONS: Record<Edition, string> = {
  "en-US": "hl=en-US&gl=US&ceid=US:en",
  "he-IL": "hl=he&gl=IL&ceid=IL:he",
};

/** What was pasted, for caching the resolved feed URL: a change to it resolves again. */
export const sourceInput = (s: Source) => (s.kind === "search" ? `${s.edition}|${s.query}` : (s.url ?? "").trim());

/** The feed URL for a source. `cached` is reused when the pasted input hasn't changed. */
export async function resolveFeed(s: Source, cached?: { input: string; feedUrl: string }): Promise<string> {
  const input = sourceInput(s);
  if (s.kind === "search") {
    if (!s.query?.trim()) throw new Error("No search phrase");
    return `https://news.google.com/rss/search?q=${encodeURIComponent(s.query.trim())}&${EDITIONS[s.edition ?? "en-US"]}`;
  }
  if (cached && cached.input === input) return cached.feedUrl;
  if (!input) throw new Error("No URL");
  return s.kind === "youtube" ? youtubeFeed(input) : discoverFeed(input);
}

async function youtubeFeed(input: string): Promise<string> {
  let url = input;
  if (/^@[\w.-]+$/.test(url)) url = `https://www.youtube.com/${url}`;
  if (!/^https?:\/\//.test(url)) url = `https://${url}`;
  const direct = /\/channel\/(UC[\w-]{22})/.exec(url)?.[1];
  const id = direct ?? (await channelIdFromPage(url));
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
}

async function channelIdFromPage(url: string): Promise<string> {
  const { text } = await getText(url);
  const id =
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(text)?.[1] ??
    /"externalId":"(UC[\w-]{22})"/.exec(text)?.[1] ??
    /"channelId":"(UC[\w-]{22})"/.exec(text)?.[1];
  if (!id) throw new Error("Couldn't find the YouTube channel on that page");
  return id;
}

const looksLikeFeed = (type: string, text: string) =>
  (/xml|rss|atom/i.test(type) && !/html/i.test(type)) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)\b/i.test(text);

/** A feed URL from a feed URL or a site URL: the page's <link rel="alternate">, else the usual paths. */
async function discoverFeed(input: string): Promise<string> {
  const start = /^https?:\/\//.test(input) ? input : `https://${input}`;
  const page = await getText(start);
  if (looksLikeFeed(page.type, page.text)) return page.url;
  const links = [...page.text.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  for (const tag of links) {
    if (/rel=["']?alternate/i.test(tag) && /type=["']?application\/(rss|atom)\+xml/i.test(tag)) {
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      if (href) return new URL(href.replace(/&amp;/g, "&"), page.url).toString();
    }
  }
  const origin = new URL(page.url).origin;
  for (const path of ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"]) {
    try {
      const g = await getText(origin + path, { timeoutMs: 10_000 });
      if (looksLikeFeed(g.type, g.text)) return g.url;
    } catch { /* try the next */ }
  }
  throw new Error("No RSS or Atom feed found on that page");
}

// ── parsing ───────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => ["item", "entry", "link", "media:content", "media:thumbnail", "enclosure"].includes(name),
});

type X = Record<string, unknown>;
const txt = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === "object") return txt((v as X)["#text"]);
  return "";
};
const list = (v: unknown): X[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as X[];
const attr = (v: unknown, name: string) => (v && typeof v === "object" ? txt((v as X)[`@_${name}`]) : "");

function linkOf(it: X): string {
  for (const l of list(it.link)) {
    if (typeof l === "string" || typeof l === "number") { if (isHttpUrl(String(l))) return String(l); continue; }
    const href = attr(l, "href");
    const rel = attr(l, "rel");
    if (href && (!rel || rel === "alternate")) return href;
    const t = txt(l);
    if (isHttpUrl(t)) return t;
  }
  const guid = txt(it.guid) || txt(it.id);
  return isHttpUrl(guid) ? guid : "";
}

function imageOf(it: X, html: string): string | undefined {
  const group = (it["media:group"] ?? {}) as X;
  const candidates = [
    ...list(it["media:content"]).filter((m) => !attr(m, "medium") || attr(m, "medium") === "image" || /^image\//.test(attr(m, "type"))).map((m) => attr(m, "url")),
    ...list(it["media:thumbnail"]).map((m) => attr(m, "url")),
    ...list(group["media:thumbnail"]).map((m) => attr(m, "url")),
    ...list(it.enclosure).filter((e) => /^image\//.test(attr(e, "type"))).map((e) => attr(e, "url")),
    /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1] ?? "",
  ];
  return candidates.find((u) => isHttpUrl(u));
}

/** Read a feed and return its items, newest first. */
export async function readFeed(s: Source, feedUrl: string): Promise<RawItem[]> {
  const { text } = await getText(feedUrl, { accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5" });
  let doc: X;
  try { doc = parser.parse(text) as X; } catch (e) { throw new Error(`Not a valid feed: ${(e as Error).message}`); }
  const rss = (doc.rss as X | undefined)?.channel as X | undefined;
  const rdf = doc["rdf:RDF"] as X | undefined;
  const atom = doc.feed as X | undefined;
  const raw = list(rss?.item ?? rdf?.item ?? atom?.entry);
  if (!rss && !rdf && !atom) throw new Error("Not an RSS or Atom feed");

  const isYouTube = /youtube\.com\/feeds\//.test(feedUrl);
  const isGoogleNews = /news\.google\.com\/rss/.test(feedUrl);
  const now = Date.now();
  const items: RawItem[] = [];
  for (const it of raw) {
    const url = linkOf(it);
    let title = stripHtml(txt(it.title));
    if (!url || !title) continue;
    const group = (it["media:group"] ?? {}) as X;
    const descHtml = txt(it.description) || txt(it.summary) || txt(group["media:description"]);
    const contentHtml = txt(it["content:encoded"]) || txt(it.content);
    let snippet = stripHtml(descHtml || contentHtml);
    const full = contentHtml ? stripHtml(contentHtml) : "";
    const when = Date.parse(txt(it.pubDate) || txt(it.published) || txt(it.updated) || txt(it["dc:date"]));

    let sourceName = s.name;
    if (isGoogleNews) {
      // "Headline - Publisher": the publisher is in <source>; the description only repeats the headline.
      const publisher = txt(it.source);
      if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3));
      if (publisher) sourceName = `${publisher} (via Google News)`;
      snippet = "";
    }
    if (snippet.startsWith(title)) snippet = snippet.slice(title.length).trim();

    items.push({
      key: hash(canonicalUrl(url)),
      sourceId: s.id,
      sourceName,
      kind: isYouTube ? "video" : isGoogleNews ? "headline" : "article",
      url,
      title,
      snippet: snippet.slice(0, 5000),
      fullText: full.length > 1500 ? full.slice(0, 30_000) : undefined,
      publishedAt: Number.isFinite(when) ? Math.min(when, now) : now,
      image: imageOf(it, descHtml + contentHtml),
      hints: s.topics ?? [],
    });
  }
  return items.sort((a, b) => b.publishedAt - a.publishedAt);
}
