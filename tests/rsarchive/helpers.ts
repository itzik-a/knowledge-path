/* Test helpers: a Fetcher that serves the saved pages in tests/fixtures (and a tiny PNG for any
   image), 404 for anything else. */
import { readFileSync } from "node:fs";
import { HttpError, type Fetcher } from "../../enricher/rsarchive/net.ts";

const dir = new URL("./fixtures/", import.meta.url);
export const FIXTURE_URLS: Record<string, string> = JSON.parse(readFileSync(new URL("index.json", dir), "utf8"));

export const fixture = (name: string) => readFileSync(new URL(`${name}.html`, dir), "utf8");
export const urlOf = (name: string) => Object.entries(FIXTURE_URLS).find(([, f]) => f === `${name}.html`)![0];

// A 1×1 PNG.
export const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
);

export function fixtureFetcher(): Fetcher & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async get(url) {
      const u = url.split("#")[0];
      requested.push(u);
      const file = FIXTURE_URLS[u];
      if (file) return { url: u, type: "text/html; charset=UTF-8", data: new TextEncoder().encode(readFileSync(new URL(file, dir), "utf8")) };
      if (/\.(png|jpe?g|gif|webp)$/i.test(u)) return { url: u, type: "image/png", data: PNG };
      throw new HttpError(404, u);
    },
  };
}
