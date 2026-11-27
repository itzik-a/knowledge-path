/* Videos that can play on a saved link's page: YouTube (through youtube-nocookie.com, which sets no cookies until
   play) and Vimeo. `videoOf(url)` finds the video and where it starts; `embedUrl` is the player's address.
   DOM- and Node-free (the app only uses it, but it's tested alone). */

export interface Video {
  site: "youtube" | "vimeo";
  id: string;
  /** Vimeo's hash for an unlisted video (vimeo.com/123/abcdef) */
  hash?: string;
  /** seconds to start at (?t=1m30s, ?t=90, #t=90, ?start=90) */
  start?: number;
  /** a YouTube Short: shown upright */
  vertical?: boolean;
}

const YT_ID = /^[\w-]{11}$/;

/** "1h2m3s", "90s", "90" → seconds. */
export function parseStart(v: string | null | undefined): number | undefined {
  if (!v) return;
  if (/^\d+$/.test(v)) return Number(v) || undefined;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || !(m[1] || m[2] || m[3])) return;
  const s = (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0);
  return s || undefined;
}

export function videoOf(raw: string | undefined): Video | undefined {
  if (!raw) return;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return; }
  if (!/^https?:$/.test(u.protocol)) return;
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const hashT = /(?:^|&)t=([^&]+)/.exec(u.hash.slice(1))?.[1];
  const start = parseStart(u.searchParams.get("t") ?? u.searchParams.get("start") ?? hashT);
  const at = start ? { start } : {};

  if (host === "youtu.be" && parts[0] && YT_ID.test(parts[0])) return { site: "youtube", id: parts[0], ...at };
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (parts[0] === "watch" && v && YT_ID.test(v)) return { site: "youtube", id: v, ...at };
    if (["shorts", "live", "embed", "v"].includes(parts[0]) && parts[1] && YT_ID.test(parts[1])) {
      return { site: "youtube", id: parts[1], ...at, ...(parts[0] === "shorts" ? { vertical: true } : {}) };
    }
    return;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const p = host === "player.vimeo.com" && parts[0] === "video" ? parts.slice(1) : parts;
    // vimeo.com/123, vimeo.com/123/abcdef (unlisted), vimeo.com/channels/x/123, vimeo.com/groups/x/videos/123
    const i = p.findIndex((x) => /^\d{5,}$/.test(x));
    if (i < 0) return;
    const hash = u.searchParams.get("h") ?? (p[i + 1] && /^[0-9a-f]{6,}$/i.test(p[i + 1]) ? p[i + 1] : undefined);
    return { site: "vimeo", id: p[i], ...(hash ? { hash } : {}), ...at };
  }
  return;
}

/** The player's address; `autoplay` because it's loaded by a tap on the preview. */
export function embedUrl(v: Video, autoplay = true): string {
  if (v.site === "youtube") {
    const q = new URLSearchParams({ rel: "0", playsinline: "1", ...(autoplay ? { autoplay: "1" } : {}), ...(v.start ? { start: String(v.start) } : {}) });
    return `https://www.youtube-nocookie.com/embed/${v.id}?${q}`;
  }
  const q = new URLSearchParams({ dnt: "1", ...(v.hash ? { h: v.hash } : {}), ...(autoplay ? { autoplay: "1" } : {}) });
  return `https://player.vimeo.com/video/${v.id}?${q}${v.start ? `#t=${v.start}s` : ""}`;
}

/** A still for the preview when the link has no image of its own (YouTube only: Vimeo's needs an API call). */
export const thumbOf = (v: Video): string | undefined => (v.site === "youtube" ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : undefined);
