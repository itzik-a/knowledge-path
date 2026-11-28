/* The readable text of an article page (Mozilla Readability on a linkedom DOM), with the page's
   og: title / description / image as a fallback. YouTube pages give the full video description. */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { decodeEntities, getText, isHttpUrl } from "./net.ts";

export interface Extracted {
  url: string;
  title: string;
  text: string;
  basis: "full" | "excerpt" | "description";
  image?: string;
  siteName?: string;
}

/** Up to this many characters of an article go to the summary (about 8K tokens): enough for news, and it bounds the cost. */
export const MAX_ARTICLE_CHARS = 30_000;

const meta = (doc: Document, key: string) =>
  doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute("content")?.trim() || "";

const tidy = (s: string) => s.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export async function extract(url: string): Promise<Extracted> {
  const page = await getText(url);
  const { document } = parseHTML(page.text) as unknown as { document: Document };
  const ogTitle = decodeEntities(meta(document, "og:title") || document.title || "");
  const ogDesc = decodeEntities(meta(document, "og:description") || meta(document, "description"));
  const ogImage = meta(document, "og:image");
  const image = isHttpUrl(ogImage) ? ogImage : undefined;
  const siteName = meta(document, "og:site_name") || undefined;

  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(new URL(page.url).hostname)) {
    const m = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(page.text);
    let desc = ogDesc;
    if (m) { try { desc = JSON.parse(`"${m[1]}"`) as string; } catch { /* keep og */ } }
    return { url: page.url, title: ogTitle, text: tidy(desc).slice(0, MAX_ARTICLE_CHARS), basis: "description", image, siteName: "YouTube" };
  }

  let article: { title?: string | null; textContent?: string | null } | null = null;
  try { article = new Readability(document, { charThreshold: 400 }).parse(); } catch { /* fall back to og: */ }
  const body = tidy(article?.textContent ?? "");
  if (body.length >= 600) {
    return { url: page.url, title: ogTitle || article?.title || "", text: body.slice(0, MAX_ARTICLE_CHARS), basis: "full", image, siteName };
  }
  // Paywalls and script-built pages: only the description is readable.
  return { url: page.url, title: ogTitle || article?.title || "", text: ogDesc || body, basis: "excerpt", image, siteName };
}
