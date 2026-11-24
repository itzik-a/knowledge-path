/* Fetching pages and images from rsarchive.org politely: one request at a time with a pause between
   them, retries on 429 / 5xx (honouring Retry-After), and a disk cache so a re-run or a second format
   costs the site nothing. A Fetcher is an interface so tests can serve saved pages instead. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Got {
  /** The final URL after redirects. */
  url: string;
  type: string;
  data: Uint8Array;
}

export interface Fetcher {
  get(url: string, opts?: { referer?: string }): Promise<Got>;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

export const USER_AGENT = "rsarchive-to-epub/2.0 (personal offline reading)";

export interface HttpOptions {
  /** Pause between network requests (cache hits don't wait). Default 1000 ms. */
  delayMs?: number;
  /** Where to keep fetched pages; null turns the cache off. Default: the user's cache folder. */
  cacheDir?: string | null;
  retries?: number;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export function defaultCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "rsarchive-to-epub");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function httpFetcher(opts: HttpOptions = {}): Fetcher {
  const delayMs = opts.delayMs ?? 1000;
  const cacheDir = opts.cacheDir === undefined ? defaultCacheDir() : opts.cacheDir;
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let lastRequest = 0;

  const cachePath = (url: string) => {
    const key = createHash("sha256").update(url).digest("hex").slice(0, 32);
    return join(cacheDir!, key.slice(0, 2), key);
  };

  async function fromCache(url: string): Promise<Got | null> {
    if (!cacheDir) return null;
    try {
      const p = cachePath(url);
      const meta = JSON.parse(await readFile(p + ".json", "utf8")) as { url: string; type: string };
      return { ...meta, data: new Uint8Array(await readFile(p)) };
    } catch {
      return null;
    }
  }

  async function toCache(url: string, got: Got) {
    if (!cacheDir) return;
    const p = cachePath(url);
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, got.data);
    await writeFile(p + ".json", JSON.stringify({ url: got.url, type: got.type }));
  }

  async function once(url: string, referer?: string): Promise<Got> {
    const wait = lastRequest + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": USER_AGENT, ...(referer ? { Referer: referer } : {}) },
    });
    if (!res.ok) {
      const err = new HttpError(res.status, url);
      (err as HttpError & { retryAfter?: number }).retryAfter = Number(res.headers.get("retry-after")) || undefined;
      throw err;
    }
    return { url: res.url || url, type: res.headers.get("content-type") ?? "", data: new Uint8Array(await res.arrayBuffer()) };
  }

  return {
    async get(rawUrl, { referer } = {}) {
      const url = rawUrl.split("#")[0];
      const cached = await fromCache(url);
      if (cached) return cached;
      for (let attempt = 0; ; attempt++) {
        try {
          const got = await once(url, referer);
          await toCache(url, got);
          return got;
        } catch (e) {
          const status = e instanceof HttpError ? e.status : 0;
          const retryable = status === 0 || status === 429 || status >= 500;
          if (!retryable || attempt >= retries) throw e;
          const after = (e as { retryAfter?: number }).retryAfter;
          const backoff = after ? after * 1000 : 2000 * 2 ** attempt;
          opts.log?.(`  retrying in ${Math.round(backoff / 1000)} s (${e instanceof Error ? e.message : e})`);
          await sleep(backoff);
        }
      }
    },
  };
}

/** Decode a page with its declared charset (rsarchive.org pages are UTF-8; this is a safety net). */
export function decodeHtml(got: Got): string {
  let charset = /charset=["']?([\w-]+)/i.exec(got.type)?.[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(got.data.subarray(0, 2048));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(got.data);
  } catch {
    return new TextDecoder("utf-8").decode(got.data);
  }
}
