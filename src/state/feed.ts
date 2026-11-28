/* The feed in the app: what the collector wrote (feed.json on the vault's `feed` branch, outside the text sync:
   downloaded with its ETag, so an unchanged file costs nothing, kept in IndexedDB meta "feed" for offline and the
   first paint), and my side of it in the vault: settings (.hub/feed/settings.json) and marks (.hub/feed/marks.json),
   read and written through the store like any file, so the sync carries them (merged item by item).
   Reviewing: Keep makes an entry a saved link (with its summary and points, the topics chosen; the enricher then
   fetches the article), Dismiss sets it aside; both with Undo. Run now writes a request the vault's Feed workflow
   answers on the branch; while one waits, the branch is checked every 20 seconds. */
import { useMemo, useSyncExternalStore } from "react";
import {
  FEED_BRANCH, FEED_FILE, FEED_MARKS_PATH, FEED_SETTINGS_PATH, feedRequestId, feedRequestPath, isFeedRequestPath, keptNotes,
  parseFeed, parseFeedSettings, parseMarks, serializeMarks, serializeSettings, waitingEntries,
  type Edition, type Entry, type FeedFile, type FeedMarks, type FeedSettings, type Mark, type Source, type SourceKind, type Topic,
} from "../../shared/feed.ts";
import { showToast } from "../lib/toast";
import { createResource } from "./actions";
import { getMeta, setMeta } from "./db";
import { allRecords, getIndex, getRecord, readFile, removeFile, removeFiles, useVault, writeFile } from "./store";
import { fetchBranchText, getConfig, syncNow } from "./sync";

// ── what the collector wrote ────────────────────────────────────

export interface FeedState {
  feed: FeedFile | null;
  /** unknown: not checked yet; none: no feed branch yet (nothing has run); ok; error (and `feed` is the last copy) */
  status: "unknown" | "none" | "ok" | "error";
  checkedAt?: number;
  error?: string;
}

let state: FeedState = { feed: null, status: "unknown" };
let etag: string | undefined;
let busy: Promise<void> | null = null;
const subs = new Set<() => void>();
const set = (x: Partial<FeedState>) => { state = { ...state, ...x }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const useFeed = () => useSyncExternalStore(subscribe, () => state);
export const getFeed = () => state;

/** Check the branch for a newer feed.json. */
export function refreshFeed(): Promise<void> {
  if (!getConfig()) return Promise.resolve();
  busy ??= (async () => {
    try {
      const r = await fetchBranchText(FEED_FILE, FEED_BRANCH, etag);
      const checkedAt = Date.now();
      if (r === null) set({ checkedAt, status: state.feed ? "ok" : state.status, error: undefined });
      else if (r === undefined) { etag = undefined; set({ feed: null, status: "none", checkedAt, error: undefined }); await setMeta("feed", null); }
      else {
        etag = r.etag;
        set({ feed: parseFeed(r.text), status: "ok", checkedAt, error: undefined });
        await setMeta("feed", { text: r.text, etag });
        settleRequests();
      }
    } catch (e) {
      set({ status: state.feed ? "ok" : "error", error: (e as Error).message });
    } finally {
      busy = null;
    }
  })();
  return busy;
}

let timer = 0;
/** Load the last copy, check for a newer one, then keep checking: every 3 minutes while the app is open, every 20
    seconds while a Run now request waits, and whenever the app comes back. */
export async function startFeed() {
  const cached = await getMeta<{ text: string; etag?: string } | null>("feed");
  if (cached?.text) { etag = cached.etag; set({ feed: parseFeed(cached.text), status: "ok" }); }
  const loop = async () => {
    if (document.visibilityState === "visible") await refreshFeed();
    timer = window.setTimeout(loop, pendingRequests().length ? 20_000 : 180_000);
  };
  void loop();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refreshFeed(); });
}
/** Check again soon (after Run now): the next check in 20 seconds rather than 3 minutes. */
function checkSoon() {
  clearTimeout(timer);
  timer = window.setTimeout(async function loop() {
    if (document.visibilityState === "visible") await refreshFeed();
    timer = window.setTimeout(loop, pendingRequests().length ? 20_000 : 180_000);
  }, 20_000);
}

// ── Run now ─────────────────────────────────────────────────────

/** Run now requests in the vault the collector hasn't answered yet. */
export function pendingRequests(): string[] {
  const answered = state.feed?.requests ?? {};
  return allRecords().filter((r) => !r.deleted && isFeedRequestPath(r.path)).map((r) => feedRequestId(r.path)).filter((id) => !answered[id]);
}
/** a run that hasn't answered after this long isn't coming (the workflow stops itself after 15 minutes) */
const STALE_MS = 20 * 60_000;
const askedAt = (id: string) => Number(parseMaybe(readFile(feedRequestPath(id)))?.at) || 0;
const isStale = (id: string) => Date.now() - askedAt(id) > STALE_MS;

/** A Run now in progress: when it was asked for, whether the request has reached GitHub yet (`sent`), and `stale`
    when it never answered. It's read from the vault's files, so it survives a reload and shows on every device. */
export function useRunning(): { since?: number; sent: boolean; stale: boolean } | null {
  useVault();
  useFeed();
  const ids = pendingRequests();
  if (!ids.length) return null;
  const since = Math.min(...ids.map(askedAt)) || undefined;
  return { since, sent: ids.some((id) => !getRecord(feedRequestPath(id))?.dirty), stale: ids.every(isStale) };
}
const parseMaybe = (t?: string): Record<string, unknown> | undefined => { try { return t ? JSON.parse(t) : undefined; } catch { return undefined; } };

/** Ask the vault's Feed workflow for a summary run now. */
export function runNow() {
  const waiting = pendingRequests();
  if (waiting.some((id) => !isStale(id))) return; // one at a time
  for (const id of waiting) removeFile(feedRequestPath(id)); // ones that never answered
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  writeFile(feedRequestPath(id), JSON.stringify({ kind: "feed", at: Date.now() }) + "\n");
  void syncNow();
  checkSoon();
}

/** Requests the collector has answered: say how it went once, and take them out of the vault. */
function settleRequests() {
  const answered = state.feed?.requests ?? {};
  for (const r of allRecords()) {
    if (r.deleted || !isFeedRequestPath(r.path)) continue;
    const a = answered[feedRequestId(r.path)];
    if (!a) continue;
    removeFile(r.path);
    showToast(a.error ? `Feed run failed: ${a.error}` : a.added ? `Feed updated: ${a.added} new` : "Feed updated: nothing new");
  }
}

// ── my settings and marks (vault files) ─────────────────────────

export function useFeedSettings(): FeedSettings {
  useVault();
  const text = readFile(FEED_SETTINGS_PATH);
  return useMemo(() => parseFeedSettings(text), [text]);
}

/** Change the feed settings; `prefs` marks a change to days to keep or automatic runs (merged as one). */
export function updateFeedSettings(fn: (s: FeedSettings) => void, opts: { prefs?: boolean } = {}) {
  const s = parseFeedSettings(readFile(FEED_SETTINGS_PATH));
  fn(s);
  if (opts.prefs) s.prefsAt = Date.now();
  writeFile(FEED_SETTINGS_PATH, serializeSettings(s));
}

export function useFeedMarks(): FeedMarks {
  useVault();
  const text = readFile(FEED_MARKS_PATH);
  return useMemo(() => parseMarks(text), [text]);
}

/** Change marks (null removes one; `exact` writes them as given instead of over the old ones); returns what they
    were, for Undo. */
function setMarks(changes: Record<string, Partial<Mark> | null>, exact = false): FeedMarks {
  const m = parseMarks(readFile(FEED_MARKS_PATH));
  const before: FeedMarks = {};
  const now = Date.now();
  for (const [id, patch] of Object.entries(changes)) {
    if (m[id]) before[id] = m[id];
    if (patch === null) { delete m[id]; continue; }
    const next: Mark = { ...(exact ? {} : m[id]), ...patch, at: now };
    for (const k of Object.keys(next) as (keyof Mark)[]) if (next[k] === undefined) delete next[k];
    m[id] = next;
  }
  writeFile(FEED_MARKS_PATH, serializeMarks(m, now));
  return before;
}
function restoreMarks(ids: string[], before: FeedMarks) {
  setMarks(Object.fromEntries(ids.map((id) => [id, before[id] ? { ...before[id] } : null])), true);
}

/** Entries still waiting for a decision (with my marks applied). */
export function useWaiting(): Entry[] {
  const { feed } = useFeed();
  const marks = useFeedMarks();
  return useMemo(() => (feed ? waitingEntries(feed, marks) : []), [feed, marks]);
}

// ── reviewing ───────────────────────────────────────────────────

const typeOf = (e: Entry) => (e.sources[0]?.kind === "video" ? "video" : "article") as "video" | "article";

/** A saved link already in the vault for this entry's main link. */
function existingFor(e: Entry): string | undefined {
  const url = e.sources[0]?.url;
  if (!url) return undefined;
  for (const d of getIndex().docs.values()) if (d.kind === "resource" && d.resource?.url === url) return d.path;
  return undefined;
}

/** Keep entries: each becomes a saved link with the topics chosen (none: it waits in To file). */
export function keepEntries(entries: Entry[], topics: string[]) {
  const made: string[] = [];
  const changes: Record<string, Partial<Mark>> = {};
  let already = 0;
  for (const e of entries) {
    const had = existingFor(e);
    if (had) { already++; changes[e.id] = { s: "kept", path: had }; continue; }
    const first = e.sources[0];
    const path = createResource({
      title: e.title, url: first?.url, type: typeOf(e), site: first?.sourceName, image: e.image, topics,
      summary: e.tldr, notes: keptNotes(e),
    });
    made.push(path);
    changes[e.id] = { s: "kept", path };
  }
  const ids = Object.keys(changes);
  const before = setMarks(changes);
  const text = entries.length === 1
    ? (already ? "Already in your library" : topics.length ? "Kept in your library" : "Kept: it waits in To file for a topic")
    : `Kept ${entries.length}${already ? ` (${already} already in your library)` : ""}`;
  showToast(text, { label: "Undo", run: () => { if (made.length) removeFiles(made); restoreMarks(ids, before); } });
}

export function dismissEntries(ids: string[]) {
  const before = setMarks(Object.fromEntries(ids.map((id) => [id, { s: "dismissed" as const }])));
  showToast(ids.length === 1 ? "Dismissed" : `Dismissed ${ids.length}`, { label: "Undo", run: () => restoreMarks(ids, before) });
}

/** 👍 / 👎 (the same again clears it). */
export function vote(id: string, v: 1 | -1) {
  const cur = parseMarks(readFile(FEED_MARKS_PATH))[id]?.v;
  setMarks({ [id]: { v: cur === v ? undefined : v } });
}

// ── sources and feed topics (settings) ──────────────────────────

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** What a pasted URL probably is: a YouTube channel (a URL or an @handle) or a site / feed. */
export function sourceFromUrl(raw: string): { kind: SourceKind; url: string; name: string } {
  let input = raw.trim();
  if (/^@[\w.-]+$/.test(input)) return { kind: "youtube", url: `https://www.youtube.com/${input}`, name: input.slice(1) };
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
  let host = "", path = "";
  try { const u = new URL(input); host = u.hostname.replace(/^www\.|^m\./, ""); path = u.pathname; } catch { /* keep raw */ }
  if (/(^|\.)youtube\.com$/.test(host)) {
    const handle = /^\/@([^/]+)/.exec(path)?.[1] ?? /^\/(?:c|user)\/([^/]+)/.exec(path)?.[1];
    return { kind: "youtube", url: input, name: handle ? decodeURIComponent(handle) : "YouTube channel" };
  }
  return { kind: "rss", url: input, name: host || input };
}

export function addSource(s: { kind: SourceKind; name: string; url?: string; query?: string; edition?: Edition; topics?: string[] }): string {
  const id = newId();
  updateFeedSettings((x) => {
    x.sources.push({ id, kind: s.kind, name: s.name.trim() || "Untitled", url: s.url?.trim() || undefined, query: s.query?.trim() || undefined, edition: s.edition, topics: s.topics ?? [], enabled: true, updatedAt: Date.now() });
  });
  return id;
}

export function editSource(id: string, fn: (s: Source) => void) {
  updateFeedSettings((x) => { const s = x.sources.find((y) => y.id === id); if (s) { fn(s); s.updatedAt = Date.now(); } });
}

export function deleteSource(id: string) {
  const s = parseFeedSettings(readFile(FEED_SETTINGS_PATH)).sources.find((x) => x.id === id);
  if (!s) return;
  editSource(id, (x) => { x.deletedAt = Date.now(); });
  showToast(`Removed ${s.name}`, { label: "Undo", run: () => editSource(id, (x) => { delete x.deletedAt; }) });
}

export function addTopic(name: string, description: string): string {
  const id = newId();
  updateFeedSettings((x) => { x.topics.push({ id, name: name.trim(), description: description.trim(), minScore: 60, enabled: true, updatedAt: Date.now() }); });
  return id;
}

export function editTopic(id: string, fn: (t: Topic) => void) {
  updateFeedSettings((x) => { const t = x.topics.find((y) => y.id === id); if (t) { fn(t); t.updatedAt = Date.now(); } });
}

export function deleteTopic(id: string) {
  const t = parseFeedSettings(readFile(FEED_SETTINGS_PATH)).topics.find((x) => x.id === id);
  if (!t) return;
  editTopic(id, (x) => { x.deletedAt = Date.now(); });
  showToast(`Removed ${t.name}`, { label: "Undo", run: () => editTopic(id, (x) => { delete x.deletedAt; }) });
}

export function setKeepDays(days: number) {
  updateFeedSettings((x) => { x.keepDays = Math.max(1, Math.min(60, Math.round(days))); }, { prefs: true });
}
