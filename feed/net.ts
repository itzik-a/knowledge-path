/* HTTP and text helpers for the collector. */
import { createHash } from "node:crypto";

/* A browser-like agent: several news sites refuse requests that don't look like a browser.
   "FeedPath" at the end says what it is. */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 KnowledgePath/1.0";
const MAX_BYTES = 4 * 1024 * 1024;

export interface Got { url: string; status: number; type: string; text: string }

/** GET a page or feed as text, decoded with its declared charset (some Hebrew sites still use windows-1255). */
export async function getText(url: string, opts: { timeoutMs?: number; accept?: string } = {}): Promise<Got> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    headers: {
      "User-Agent": UA,
      Accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error(`Too large (${Math.round(buf.byteLength / 1024)} KB): ${url}`);
  const type = res.headers.get("content-type") ?? "";
  return { url: res.url || url, status: res.status, type, text: decode(buf, type) };
}

function decode(buf: Uint8Array, type: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(type)?.[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.subarray(0, 2048));
    charset = /<\?xml[^>]*encoding=["']([\w-]+)/i.exec(head)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try { return new TextDecoder(charset || "utf-8").decode(buf); }
  catch { return new TextDecoder("utf-8").decode(buf); }
}

/** Run `fn` over `items`, at most `n` at a time. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export const hash = (s: string, len = 16) => createHash("sha256").update(s).digest("base64url").slice(0, len);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML (or text with stray tags) → plain text on one line per paragraph. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export const isHttpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

/** The same article often arrives with tracking parameters; drop them for matching. */
export function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|cmpid|smid|partner)/i.test(k)) url.searchParams.delete(k);
    }
    return url.toString();
  } catch { return u; }
}
