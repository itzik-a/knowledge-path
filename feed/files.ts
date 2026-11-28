/* Where the collector reads and writes.
   - Settings (sources, topics, days to keep, automatic runs) and Run now requests: the vault checkout (main),
     read only. The collector never commits to main.
   - feed.json and collector.json: the vault's `feed` branch, replaced on each run by one parentless commit (pushed
     with the credentials actions/checkout left in the vault's git config, as the EPUB branches are), so the vault's
     history never holds the feed.
   - --local / --dry: both files in feed/out/ instead of the branch. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEED_BRANCH, FEED_FILE, FEED_REQUEST_DIR, FEED_REQUEST_PREFIX, FEED_SETTINGS_PATH, STATE_FILE,
  normalizeState, parseFeed, parseFeedSettings, type CollectorState, type FeedFile, type FeedSettings,
} from "../shared/feed.ts";

const git = (cwd: string, args: string[], input?: string) =>
  execFileSync("git", args, {
    cwd, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Knowledge Path feed", GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
      GIT_COMMITTER_NAME: "Knowledge Path feed", GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    },
  }).trim();

const readText = (path: string) => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };

/** The feed settings in the vault (the starting sources and topics if there are none yet). */
export const readSettings = (vault: string | undefined): FeedSettings => parseFeedSettings(vault ? readText(join(vault, FEED_SETTINGS_PATH)) : undefined);

/** Run now requests waiting in the vault: their ids. */
export function readRequests(vault: string): string[] {
  const dir = join(vault, FEED_REQUEST_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(FEED_REQUEST_PREFIX) && f.endsWith(".json")).map((f) => f.slice(FEED_REQUEST_PREFIX.length, -".json".length));
}

export interface Data { feed: FeedFile; state: CollectorState }

/** feed.json and collector.json from the `feed` branch (empty when it doesn't exist yet). */
export function readBranch(vault: string): Data {
  let has = false;
  try { git(vault, ["fetch", "--quiet", "--depth=1", "origin", `+refs/heads/${FEED_BRANCH}:refs/remotes/origin/${FEED_BRANCH}`]); has = true; }
  catch { console.log(`No ${FEED_BRANCH} branch yet: starting the feed.`); }
  const show = (file: string) => { if (!has) return undefined; try { return git(vault, ["show", `origin/${FEED_BRANCH}:${file}`]); } catch { return undefined; } };
  let state: unknown;
  try { state = JSON.parse(show(STATE_FILE) ?? ""); } catch { state = undefined; }
  return { feed: parseFeed(show(FEED_FILE)), state: normalizeState(state) };
}

/** Replace the `feed` branch with one commit holding the two files (no parent: no history). */
export function writeBranch(vault: string, data: Data, message: string) {
  const blob = (text: string) => git(vault, ["hash-object", "-w", "--stdin"], text);
  const tree = git(vault, ["mktree"], `100644 blob ${blob(JSON.stringify(data.feed))}\t${FEED_FILE}\n100644 blob ${blob(JSON.stringify(data.state))}\t${STATE_FILE}\n`);
  const commit = git(vault, ["commit-tree", tree, "-m", message]);
  git(vault, ["push", "--force", "--quiet", "origin", `${commit}:refs/heads/${FEED_BRANCH}`]);
}

/** --local / --dry: the same two files in a folder. */
export function readFolder(dir: string): Data {
  let state: unknown;
  try { state = JSON.parse(readText(join(dir, STATE_FILE)) ?? ""); } catch { state = undefined; }
  return { feed: parseFeed(readText(join(dir, FEED_FILE))), state: normalizeState(state) };
}

export function writeFolder(dir: string, data: Data) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FEED_FILE), JSON.stringify(data.feed, null, 1));
  writeFileSync(join(dir, STATE_FILE), JSON.stringify(data.state));
}
