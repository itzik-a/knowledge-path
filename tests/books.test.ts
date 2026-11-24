import { describe, expect, it } from "vitest";
import { bookOf, chaptersIn, citation, isRsarchive, plainLinks, readingText, sectionsOf } from "../shared/books.ts";
import { buildIndex, inbox, parseDoc, resolve, type Doc } from "../shared/index.ts";
import { kindOf } from "../shared/vault.ts";
import { renderMarkdown } from "../src/lib/markdown.ts";
import { markdown } from "../enricher/rsarchive/markdown.ts";
import { contents, scrape } from "../enricher/rsarchive/scrape.ts";
import { fixtureFetcher, urlOf } from "./rsarchive/helpers.ts";
import { GENERIC_SUMMARY, importBook, summaryOf } from "../enricher/book.ts";
import { branchFor, buildEpub, deleteBranches, epubBranches, pushToBranch } from "../enricher/epubs.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ix = (files: Record<string, string>) => buildIndex(new Map(Object.entries(files).map(([p, c]) => [p, parseDoc(p, c)] as [string, Doc])));

/** GA 283 as the enricher writes it into a vault (only Lecture I is a saved page; the rest 404). */
async function vaultFiles(home = "Inner Nature of Music") {
  const fetcher = fixtureFetcher();
  const c = await contents(urlOf("lecture-index"), { fetcher });
  const { book } = await scrape(c, { fetcher });
  const files: Record<string, string> = {};
  for (const [p, data] of markdown(book, { home, images: "remote" })) files[`Books/${p}`] = data as string;
  return files;
}

describe("books", () => {
  it("files in Books/<book>/ are chapters", () => {
    expect(kindOf("Books/Riddles (GA 18)/01 Introduction.md")).toBe("chapter");
    expect(kindOf("Books/A loose note.md")).toBe("note");
    expect(kindOf("Books/A/B/deeper.md")).toBe("note");
  });

  it("reads a book's state from its home's frontmatter", () => {
    expect(bookOf({ book: "pending" }).state).toBe("pending");
    expect(bookOf({ book: "failed", bookError: "404" })).toMatchObject({ state: "failed", error: "404" });
    expect(bookOf({ book: "Books/Riddles (GA 18)", chapters: 22 })).toMatchObject({ state: "ready", folder: "Books/Riddles (GA 18)", chapters: 22 });
    expect(bookOf({}).state).toBeUndefined();
    expect(isRsarchive("https://rsarchive.org/Books/GA018/")).toBe(true);
    expect(isRsarchive("https://example.org/rsarchive.org/")).toBe(false);
  });

  it("reads chapters the enricher writes: order, date, place, book link; not in the inbox", async () => {
    const files = await vaultFiles();
    const home = "Resources/Inner Nature of Music.md";
    const index = ix({ ...files, [home]: "---\ntype: book\nurl: https://rsarchive.org/Lectures/GA283/English/AP1983/\nbook: Books/The Inner Nature of Music and the Experience of Tone (GA 283)\n---\n" });
    const chapters = chaptersIn(index, "Books/The Inner Nature of Music and the Experience of Tone (GA 283)");
    expect(chapters).toHaveLength(1);
    const ch = chapters[0];
    expect(ch.kind).toBe("chapter");
    expect(ch.title).toBe("Lecture I: The Inner Nature of Music I");
    expect(ch.chapter).toMatchObject({ book: "Inner Nature of Music", order: 1, date: "1906-12-03", place: "Cologne", translator: "Maria St. Goar", ga: "283" });
    expect(resolve(index, ch.chapter!.book!, ch.path)).toBe(home);
    expect(inbox(index).map((d) => d.path)).toEqual([home]);
    expect(sectionsOf(chapters)).toEqual([{ heading: undefined, chapters }]);
  });

  it("shows the text without its date line and navigation, with block ids hidden", async () => {
    const files = await vaultFiles();
    const body = parseDoc(Object.keys(files)[0], Object.values(files)[0]).body;
    expect(body).toMatch(/^\n?\*3 December 1906, Cologne\*/);
    expect(body).toMatch(/\|Contents\]\]\s*$/);
    const text = readingText(body);
    expect(text).toMatch(/^\\\[1\\\] For those who care/);
    expect(text).not.toContain("|Contents]]");
    const html = renderMarkdown(text, { resolve: () => undefined });
    expect(html).toContain('<p dir="auto" data-block="p1">[1] For those who care');
    expect(html).not.toMatch(/\^p\d/);
  });

  it("renders footnotes without links the hash router would follow", () => {
    const html = renderMarkdown("The sentient soul[^1] is incorporated.\n\n[^1]: Steiner distinguishes here.", { resolve: () => undefined });
    expect(html).toContain('soul<sup class="fn-ref">1</sup> is');
    expect(html).toContain('<li class="footnote-item" value="1"><p dir="auto">Steiner distinguishes here.</p>');
    expect(html).not.toContain('href="#fn');
  });

  it("cites a paragraph for a highlight, and shows links as plain text", () => {
    const cite = citation({ name: "02 Lecture I - The Inner Nature of Music I", title: "Lecture I: The Inner Nature of Music I" }, "p12");
    expect(cite).toBe("[[02 Lecture I - The Inner Nature of Music I#^p12|Lecture I: The Inner Nature of Music I, ¶ 12]]");
    expect(plainLinks(`From ${cite}`)).toBe("From Lecture I: The Inner Nature of Music I, ¶ 12");
    expect(plainLinks("See [[Stoicism]] and [[Note#Heading]]")).toBe("See Stoicism and Note");
  });
});

describe("enricher: importing a book", () => {
  it("writes chapter notes under Books/ (no EPUB in the vault) and fields for the saved link", async () => {
    const r = await importBook(urlOf("lecture-index"), "Inner Nature of Music", { fetcher: fixtureFetcher() });
    expect(r.folder).toBe("Books/The Inner Nature of Music and the Experience of Tone (GA 283)");
    expect([...r.notes.keys()]).toEqual([`${r.folder}/01 Lecture I - The Inner Nature of Music I.md`]);
    expect(r.failed).toHaveLength(8);
    expect(r.home.always).toEqual({ book: r.folder, chapters: 1 });
    expect(r.home.missing).toMatchObject({ type: "book", author: "Rudolf Steiner", translator: "Maria St. Goar", ga: "283", site: "rsarchive.org" });
    expect(r.home.missing.summary).toMatch(/^This is only one of many/);
  });

  it("summarises from the introduction's first real paragraph, and knows the site's generic description", () => {
    expect(summaryOf("<blockquote><p>Short.</p></blockquote>\n<p>A first paragraph that is long enough to say something about the book &amp; its lectures.</p><p>More.</p>"))
      .toBe("A first paragraph that is long enough to say something about the book & its lectures.");
    expect(summaryOf(`<p>${"Word ".repeat(40)}end. ${"More words ".repeat(30)}</p>`)!.length).toBeLessThanOrEqual(301);
    expect(summaryOf(undefined)).toBeUndefined();
    expect(GENERIC_SUMMARY.test("Rudolf Steiner Archive: An electronic Library and Archive site for the over 6000 collected works")).toBe(true);
  });
});

describe("enricher: EPUBs on request, on a branch of their own", () => {
  it("builds the EPUB, pushes it as the only file of an epub/<id> branch, lists and deletes such branches; main is untouched", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-epub-"));
    const g = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
    try {
      const origin = join(root, "origin.git");
      const vault = join(root, "vault");
      g(root, "init", "-q", "--bare", "-b", "main", origin);
      g(root, "clone", "-q", origin, vault);
      g(vault, "commit", "-q", "--allow-empty", "-m", "vault");
      g(vault, "push", "-q", "origin", "main");
      const mainBefore = g(origin, "rev-parse", "main");

      const b = await buildEpub(urlOf("lecture-index"), { fetcher: fixtureFetcher() });
      expect(b.file).toBe("The Inner Nature of Music and the Experience of Tone (GA 283).epub");
      expect(b.chapters).toBe(1);
      const branch = branchFor(".hub/requests/m3x9k2.json");
      expect(branch).toBe("epub/m3x9k2");
      pushToBranch(vault, branch, b.file, b.data, "EPUB: test");

      expect(g(origin, "ls-tree", "--name-only", branch)).toBe(b.file);
      expect(g(origin, "rev-list", "--count", branch)).toBe("1"); // no parent: nothing from main comes along
      expect(g(origin, "rev-parse", "main")).toBe(mainBefore);
      expect(Buffer.from(execFileSync("git", ["cat-file", "blob", `${branch}:${b.file}`], { cwd: origin })).equals(Buffer.from(b.data))).toBe(true);
      expect(epubBranches(vault)).toEqual([branch]);
      deleteBranches(vault, [branch]);
      expect(epubBranches(vault)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

