/* EPUBs on request, kept out of the vault's history. The app asks with .hub/requests/<id>.json
   { kind: "epub", url, title, at }; the enricher builds the EPUB from rsarchive.org and pushes it as the
   only file of a commit on a branch of its own, epub/<id> (not main, so it's in no clone and no history),
   then answers in the request: ready: { branch, file, size, title, at }, or error. The app downloads it
   from that branch through the API, then deletes the branch and the request; unreachable, the file is
   gone from the repo at GitHub's next clean-up. Branches nobody came for are deleted after a week.
   The push uses the credentials actions/checkout left in the vault's git config, so the vault's
   workflow needs no change (and a push to a branch other than main doesn't start it). */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { epub } from "./rsarchive/epub.ts";
import { bookFolder } from "./rsarchive/markdown.ts";
import { allChapters } from "./rsarchive/model.ts";
import type { Fetcher } from "./rsarchive/net.ts";
import { contents, scrape } from "./rsarchive/scrape.ts";

export interface EpubRequest {
  kind: "epub";
  url: string;
  title?: string;
  at?: string;
  ready?: { branch: string; file: string; size: number; title: string; chapters: number; at: string };
  error?: string;
}

export const BRANCH_PREFIX = "epub/";
export const MAX_AGE_DAYS = 7;

/** The branch for a request file: .hub/requests/m3x9k2.json → epub/m3x9k2. */
export const branchFor = (requestPath: string) => BRANCH_PREFIX + requestPath.slice(requestPath.lastIndexOf("/") + 1).replace(/\.json$/, "").replace(/[^\w.-]+/g, "-");

export async function buildEpub(url: string, opts: { fetcher: Fetcher; log?: (m: string) => void }) {
  const c = await contents(url, opts);
  const { book, failed } = await scrape(c, opts);
  return { file: `${bookFolder(book)}.epub`, data: epub(book), title: book.title, chapters: allChapters(book).length, failed };
}

const git = (cwd: string, args: string[], input?: string) =>
  execFileSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Knowledge Path enricher",
      GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
      GIT_COMMITTER_NAME: "Knowledge Path enricher",
      GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    },
  }).trim();

/** Push `data` as the only file (`file`) of a parentless commit to `branch` on the vault's origin. */
export function pushToBranch(vault: string, branch: string, file: string, data: Uint8Array, message: string): string {
  if (/[\t\n]/.test(file)) throw new Error("bad file name");
  const dir = mkdtempSync(join(tmpdir(), "epub-"));
  try {
    const tmp = join(dir, "book.epub");
    writeFileSync(tmp, data);
    const blob = git(vault, ["hash-object", "-w", tmp]);
    const tree = git(vault, ["mktree"], `100644 blob ${blob}\t${file}\n`);
    const commit = git(vault, ["commit-tree", tree, "-m", message]);
    git(vault, ["push", "--force", "--quiet", "origin", `${commit}:refs/heads/${branch}`]);
    return commit;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** epub/* branches on the vault's origin. */
export function epubBranches(vault: string): string[] {
  const out = git(vault, ["ls-remote", "--heads", "origin", `${BRANCH_PREFIX}*`]);
  return out ? out.split("\n").map((l) => l.split("\t")[1]?.replace(/^refs\/heads\//, "")).filter(Boolean) : [];
}

export function deleteBranches(vault: string, branches: string[]) {
  if (branches.length) git(vault, ["push", "--quiet", "origin", "--delete", ...branches]);
}
