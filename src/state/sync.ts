/* Sync with the vault: a private GitHub repo, through the REST API with a fine-grained token that can
   only read and write that one repo. The sync itself is src/lib/vaultsync.ts; this file is the GitHub
   client, the schedule and the status pill.

   When: on start, when the app comes back to the front, every 2 minutes while it's open (a 304 costs
   nothing), 15 s after I stop changing things (at most 60 s after the first change), when I leave the
   app, and on Sync now. localStorage "knowledgePath.vault" holds the token and repo; IndexedDB meta
   "sync" holds the last head and tree. */
import { useSyncExternalStore } from "react";
import { makeCodec } from "../../shared/private.ts";
import { VAULT_README } from "../../shared/seed.ts";
import { getPassphrase } from "../lib/passphrase";
import { lockedSketches } from "./sketches";
import { showToast } from "../lib/toast";
import { Moved, syncOnce, type Head, type LocalStore, type Remote, type SyncState, type TreeEntry } from "../lib/vaultsync";
import { getMeta, setMeta } from "./db";
import { allRecords, applyRemote, getRecord, onLocalChange, settle, writeFile } from "./store";

const LS = "knowledgePath.vault";
const API = "https://api.github.com";
export const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new?name=Knowledge%20Path&description=Read%20and%20write%20my%20knowledge%20vault&contents=write";
export const DEFAULT_REPO = "itzik-a/knowledge-vault";

export interface Config { token: string; owner: string; repo: string; branch: string }

export function getConfig(): Config | null {
  try {
    const c = JSON.parse(localStorage.getItem(LS) || "null") as Config | null;
    return c?.token && c.owner && c.repo ? { ...c, branch: c.branch || "main" } : null;
  } catch { return null; }
}

// ── status ────────────────────────────────────────────────────
export interface SyncStatus { kind: "off" | "ok" | "busy" | "pending" | "error" | "offline"; text: string; detail?: string; last?: number }
let status: SyncStatus = getConfig() ? { kind: "ok", text: "Synced" } : { kind: "off", text: "On this device" };
const sl = new Set<() => void>();
function setStatus(s: Partial<SyncStatus> & { kind: SyncStatus["kind"] }) {
  status = { last: status.last, ...s, text: s.text ?? TEXT[s.kind] };
  sl.forEach((l) => l());
}
const TEXT: Record<SyncStatus["kind"], string> = { off: "On this device", ok: "Synced", busy: "Syncing…", pending: "Saving soon", error: "Sync failed", offline: "Offline" };
export function useSyncStatus() {
  return useSyncExternalStore((l) => { sl.add(l); return () => { sl.delete(l); }; }, () => status);
}

// ── GitHub client ─────────────────────────────────────────────
export class GitHubError extends Error {
  status: number;
  constructor(msg: string, status: number) { super(msg); this.status = status; }
}

async function gh<T>(cfg: Config, path: string, init: RequestInit & { etag?: string } = {}): Promise<{ data: T; status: number; etag?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (init.body) headers["Content-Type"] = "application/json";
  if (init.etag) headers["If-None-Match"] = init.etag;
  let res: Response;
  try {
    res = await fetch(API + path, { ...init, headers, cache: "no-store" });
  } catch {
    throw new GitHubError("Can't reach GitHub", 0);
  }
  if (res.status === 304) return { data: null as T, status: 304, etag: init.etag };
  if (!res.ok) {
    let msg = "";
    try { msg = ((await res.json()) as { message?: string }).message ?? ""; } catch { /* no body */ }
    if (res.status === 401) throw new GitHubError("GitHub didn't accept the token (expired or revoked?)", 401);
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") throw new GitHubError("GitHub rate limit reached; it resets within the hour", 403);
    if (res.status === 403) throw new GitHubError("The token isn't allowed to do that: it needs Contents: read and write on the vault repo", 403);
    if (res.status === 404) throw new GitHubError(`Not found: ${cfg.owner}/${cfg.repo} (check the name, and that the token has access to this repo)`, 404);
    throw new GitHubError(msg || `GitHub error ${res.status}`, res.status);
  }
  const text = await res.text();
  return { data: (text ? JSON.parse(text) : null) as T, status: res.status, etag: res.headers.get("etag") ?? undefined };
}

const repoPath = (c: Config) => `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;

function b64ToText(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function textToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

let headEtag: { etag: string; sha: string } | null = null;

export function githubRemote(cfg: Config): Remote {
  const rp = repoPath(cfg);
  return {
    async head(known) {
      let ref: { data: { object: { sha: string } }; status: number; etag?: string };
      try {
        ref = await gh(cfg, `${rp}/git/ref/heads/${encodeURIComponent(cfg.branch)}`, { etag: known && headEtag?.sha === known ? headEtag.etag : undefined });
      } catch (e) {
        // 409: the repo has no commits yet. Make the first one (the Git data API needs a commit to build on).
        if (e instanceof GitHubError && (e.status === 409 || e.status === 404)) {
          const info = await gh<{ size: number }>(cfg, rp);
          if (e.status === 404 && info.data.size > 0) throw new GitHubError(`The vault has no branch "${cfg.branch}"`, 404);
          const put = await gh<{ commit: { sha: string; tree: { sha: string } } }>(cfg, `${rp}/contents/README.md`, {
            method: "PUT", body: JSON.stringify({ message: "Start the vault", content: textToB64(VAULT_README), branch: cfg.branch }),
          });
          return { commit: put.data.commit.sha, tree: put.data.commit.tree.sha };
        }
        throw e;
      }
      if (ref.status === 304) return "unchanged";
      const sha = ref.data.object.sha;
      if (ref.etag) headEtag = { etag: ref.etag, sha };
      if (known && sha === known) return "unchanged";
      const c = await gh<{ tree: { sha: string } }>(cfg, `${rp}/git/commits/${sha}`);
      return { commit: sha, tree: c.data.tree.sha };
    },
    async tree(sha) {
      const t = await gh<{ tree: { path: string; type: string; sha: string; size?: number }[]; truncated: boolean }>(cfg, `${rp}/git/trees/${sha}?recursive=1`);
      if (t.data.truncated) throw new GitHubError("The vault has too many files to list in one go", 0);
      return t.data.tree.filter((e) => e.type === "blob").map((e): TreeEntry => ({ path: e.path, sha: e.sha, size: e.size }));
    },
    async blob(sha) {
      const b = await gh<{ content: string; encoding: string }>(cfg, `${rp}/git/blobs/${sha}`);
      return b.data.encoding === "base64" ? b64ToText(b.data.content) : b.data.content;
    },
    async commit(parent: Head, changes, message) {
      const tree = await gh<{ sha: string }>(cfg, `${rp}/git/trees`, {
        method: "POST",
        body: JSON.stringify({
          base_tree: parent.tree,
          tree: changes.map((c) => c.content == null
            ? { path: c.path, mode: "100644", type: "blob", sha: null }
            : { path: c.path, mode: "100644", type: "blob", content: c.content }),
        }),
      });
      const commit = await gh<{ sha: string }>(cfg, `${rp}/git/commits`, {
        method: "POST", body: JSON.stringify({ message, tree: tree.data.sha, parents: [parent.commit] }),
      });
      try {
        await gh(cfg, `${rp}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.data.sha, force: false }) });
      } catch (e) {
        if (e instanceof GitHubError && e.status === 422) throw new Moved("The vault changed meanwhile");
        throw e;
      }
      return { commit: commit.data.sha, tree: tree.data.sha };
    },
  };
}

const localStore: LocalStore = {
  records: allRecords,
  get: getRecord,
  applyRemote,
  settle,
  add: (path, content) => writeFile(path, content),
};

// ── connecting ────────────────────────────────────────────────
export interface RepoCheck { cfg: Config; isPrivate: boolean }

/** Check a token and repo before saving them. */
export async function checkRepo(token: string, full: string): Promise<RepoCheck> {
  const [owner, repo] = full.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").split("/");
  if (!owner || !repo) throw new Error("Write the repo as owner/name, e.g. itzik-a/knowledge-vault");
  const cfg: Config = { token: token.trim(), owner, repo, branch: "main" };
  const r = await gh<{ default_branch: string; private: boolean; permissions?: { push?: boolean } }>(cfg, repoPath(cfg));
  if (r.data.permissions && !r.data.permissions.push) throw new Error("The token can read the repo but not write to it: give it Contents: read and write");
  return { cfg: { ...cfg, branch: r.data.default_branch || "main" }, isPrivate: r.data.private };
}

export async function connect(cfg: Config) {
  localStorage.setItem(LS, JSON.stringify(cfg));
  headEtag = null;
  await setMeta("sync", {});
  setStatus({ kind: "busy" });
  await syncNow(true);
}

export async function disconnect() {
  localStorage.removeItem(LS);
  headEtag = null;
  await setMeta("sync", {});
  setStatus({ kind: "off" });
}

// ── running ───────────────────────────────────────────────────
let running: Promise<void> | null = null;
let again = false;
let firstChange = 0;
let pushTimer = 0;
let lastOther: Record<string, string> = {};
export const otherFiles = () => lastOther;
const syncListeners = new Set<() => void>();
/** Called after every sync that brought something new. */
export function onSynced(l: () => void) { syncListeners.add(l); return () => { syncListeners.delete(l); }; }

export function syncNow(force = false): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return Promise.resolve();
  if (running) { again = true; return running; }
  clearTimeout(pushTimer);
  firstChange = 0;
  running = (async () => {
    setStatus({ kind: "busy" });
    try {
      const prev = ((await getMeta<SyncState>("sync")) ?? {}) as SyncState;
      let locked: Set<string> | undefined; // worked out once per sync, if a sketch goes out
      const codec = makeCodec(getPassphrase, (p) => (locked ??= lockedSketches()).has(p));
      const r = await syncOnce(githubRemote(cfg), localStore, prev, { force, codec });
      await setMeta("sync", r.state);
      if (Object.keys(r.other).length || force) lastOther = r.other;
      status.last = Date.now();
      if (r.held.length) setStatus({ kind: "pending", text: "Needs passphrase", detail: `${r.held.length === 1 ? "A locked note waits" : `${r.held.length} locked notes wait`} for your passphrase on this device before they go to the vault (Locked notes, below).` });
      else setStatus({ kind: allRecords().some((x) => x.dirty) ? "pending" : "ok" });
      if (r.conflicts.length) showToast(r.conflicts.length === 1 ? "Edited in two places: kept both copies" : `${r.conflicts.length} files edited in two places: kept both copies`);
      if (r.pulled) syncListeners.forEach((l) => l());
    } catch (e) {
      const msg = (e as Error).message;
      setStatus(e instanceof GitHubError && e.status === 0 && !navigator.onLine ? { kind: "offline", detail: "Changes are saved here and go out when you're back online." } : { kind: "error", detail: msg });
    } finally {
      running = null;
      if (again) { again = false; void syncNow(); }
    }
  })();
  return running;
}

/** Resolves when no sync is running. */
export async function whenIdle() { while (running) await running.catch(() => {}); }

/** A change was made here: push it soon. */
function schedulePush() {
  if (!getConfig()) return;
  const now = Date.now();
  if (!firstChange) firstChange = now;
  if (status.kind === "ok") setStatus({ kind: "pending" });
  clearTimeout(pushTimer);
  const wait = Math.max(0, Math.min(15_000, firstChange + 60_000 - now));
  pushTimer = window.setTimeout(() => void syncNow(), wait);
}

export function startSync() {
  onLocalChange(schedulePush);
  if (getConfig()) void syncNow();
  setInterval(() => { if (getConfig() && document.visibilityState === "visible" && !running) void syncNow(); }, 120_000);
  document.addEventListener("visibilitychange", () => {
    if (!getConfig()) return;
    if (document.visibilityState === "visible") void syncNow();
    else if (allRecords().some((r) => r.dirty)) void syncNow();
  });
  window.addEventListener("online", () => { if (getConfig()) void syncNow(); });
}
