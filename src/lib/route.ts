/* Hash routes:
   #home · #topics · #topics/<topic id> · #library · #notes · #notes/journal · #inbox · #habits · #tag/<tag>
   #doc/<vault path> (a resource, note, journal entry, study path or habit)
   #capture?url=…&title=…&text=… (from the iOS Shortcut or the Mac bookmarklet) */
export type View = "home" | "topics" | "library" | "notes" | "inbox" | "habits" | "tag" | "doc" | "capture";
const VIEWS: View[] = ["home", "topics", "library", "notes", "inbox", "habits", "tag", "doc", "capture"];

export interface Route { view: View; sub?: string; params: URLSearchParams }

export function readHash(): Route {
  const raw = location.hash.slice(1);
  const q = raw.indexOf("?");
  const pathPart = q >= 0 ? raw.slice(0, q) : raw;
  const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : "");
  const parts = pathPart.split("/").map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const view = VIEWS.includes(parts[0] as View) ? (parts[0] as View) : "home";
  return { view, sub: parts.slice(1).join("/") || undefined, params };
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
export const docHref = (path: string) => `#doc/${enc(path)}`;
export const topicHref = (id: string) => `#topics/${enc(id)}`;
export const tagHref = (tag: string) => `#tag/${enc(tag)}`;
export const go = (href: string) => { if (location.hash !== href) location.hash = href; };

/* How deep into the app this history entry is (0 = where the app was opened), so Back never leaves the app. */
const depth = () => (history.state as { kpDepth?: number } | null)?.kpDepth ?? 0;
let lastDepth = 0;
export function trackHistory() {
  if (history.state == null) history.replaceState({ kpDepth: 0 }, "");
  lastDepth = depth();
  window.addEventListener("hashchange", () => {
    if (history.state == null) history.replaceState({ kpDepth: lastDepth + 1 }, "");
    lastDepth = depth();
  });
}
/** Back within the app, or to `fallback` if this is where the app was opened. */
export const back = (fallback: string) => (depth() > 0 ? history.back() : location.replace(fallback));
