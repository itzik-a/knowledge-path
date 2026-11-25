import { describe, expect, it } from "vitest";
import { buildIndex, inbox, itemsIn, parseDoc, pinnedDocs, resolve, type Doc } from "../shared/index.ts";
import { SEED } from "../shared/seed.ts";
import {
  addHighlight, excerpt, extractLinks, extractTags, guessType, kindOf, parseHighlights, parseSteps, renameLinks, replaceHighlight,
  safeName, setBody, setFrontmatter, splitFrontmatter, strList, titleFromUrl, toggleStep, uniquePath,
} from "../shared/vault.ts";

const ix = (files: Record<string, string>) => buildIndex(new Map(Object.entries(files).map(([p, c]) => [p, parseDoc(p, c)] as [string, Doc])));

describe("frontmatter", () => {
  it("splits and parses", () => {
    const s = splitFrontmatter("---\ntype: book\ntopics:\n  - \"[[Stoicism]]\"\n---\nHello\n");
    expect(s.fm).toEqual({ type: "book", topics: ["[[Stoicism]]"] });
    expect(s.body).toBe("Hello\n");
  });
  it("handles no and empty frontmatter, and broken YAML", () => {
    expect(splitFrontmatter("Hello").body).toBe("Hello");
    expect(splitFrontmatter("---\n---\nHi").body).toBe("Hi");
    expect(splitFrontmatter("---\na: [\n---\nHi").fm).toEqual({});
  });
  it("sets keys, keeps the rest and comments, removes empties", () => {
    const t = "---\n# mine\ntype: book\nrating: 3\n---\nBody\n";
    const out = setFrontmatter(t, { status: "done", rating: undefined });
    expect(out).toBe("---\n# mine\ntype: book\nstatus: done\n---\nBody\n");
    expect(setFrontmatter("Body", { topics: ["[[A]]"] })).toBe('---\ntopics:\n  - "[[A]]"\n---\nBody');
    expect(setFrontmatter("---\na: 1\n---\nB", { a: undefined })).toBe("B");
  });
  it("setBody keeps the frontmatter", () => {
    expect(setBody("---\na: 1\n---\nold", "new")).toBe("---\na: 1\n---\nnew");
  });
  it("reads lists loosely, including unquoted [[links]]", () => {
    expect(strList("a, b")).toEqual(["a", "b"]);
    expect(strList(splitFrontmatter("---\ntopics:\n  - [[Stoicism]]\n---\n").fm.topics)).toEqual(["[[Stoicism]]"]);
  });
});

describe("links and tags", () => {
  it("finds wikilinks with headings, aliases and embeds, but not in code", () => {
    const l = extractLinks("See [[Stoicism#Ethics|the ethics]] and ![[pic.png]].\n```\n[[Not]]\n```\n`[[Nor]]` [md](Other%20Note.md)");
    expect(l.map((x) => [x.target, x.heading, x.alias, x.embed])).toEqual([
      ["Stoicism", "Ethics", "the ethics", false], ["pic.png", undefined, undefined, true], ["Other Note", undefined, undefined, false],
    ]);
  });
  it("finds tags, not headings or numbers or URL fragments", () => {
    expect(extractTags("# Heading\n#stoicism and #philosophy/ethics, #123 http://x.com/#frag #שלום", { tags: ["Extra"] }).sort())
      .toEqual(["extra", "philosophy/ethics", "stoicism", "שלום"]);
  });
  it("renames links", () => {
    expect(renameLinks("[[Old]] [[old|x]] [[Folder/Old#h]] [[Older]]", "Old", "New")).toBe("[[New]] [[New|x]] [[New#h]] [[Older]]");
  });
});

describe("kinds and names", () => {
  it("knows a file's kind from its folder", () => {
    expect(kindOf("Topics/Philosophy.md")).toBe("topic");
    expect(kindOf("Resources/Meditations.md")).toBe("resource");
    expect(kindOf("Journal/2026/2026-11-21.md")).toBe("journal");
    expect(kindOf("Journal/ideas.md")).toBe("note");
    expect(kindOf("Paths/Intro.md")).toBe("path");
    expect(kindOf("Notes/x.md")).toBe("note");
    expect(kindOf(".hub/articles/x.md")).toBe("hub");
  });
  it("makes safe, unique file names", () => {
    expect(safeName('Israel: A History / "Gilbert"?')).toBe("Israel A History Gilbert");
    expect(safeName("  ")).toBe("Untitled");
    const taken = new Set(["Notes/A.md", "Notes/A 2.md"]);
    expect(uniquePath("Notes", "A", (p) => taken.has(p))).toBe("Notes/A 3.md");
  });
  it("guesses types and placeholder titles from URLs", () => {
    expect(guessType("https://www.youtube.com/watch?v=x")).toBe("video");
    expect(guessType("https://arxiv.org/abs/1")).toBe("paper");
    expect(guessType("https://x.com/a/b.pdf")).toBe("paper");
    expect(guessType("https://example.com/")).toBe("site");
    expect(guessType("https://example.com/post/why-stoics-matter")).toBe("article");
    expect(titleFromUrl("https://www.example.com/post/why-stoics-matter.html")).toBe("Why stoics matter (example.com)");
    expect(titleFromUrl("https://example.com/12345")).toBe("example.com");
  });
  it("makes plain excerpts", () => {
    expect(excerpt("# T\nSee [[Stoicism|the Stoics]] and **bold** [x](http://y)\n- [ ] task")).toBe("See the Stoics and bold x task");
  });
});

describe("highlights", () => {
  const body = "My notes.\n\n## Highlights\n\n> First quote\n> line two\nmy comment\n\n> Second\n\n## After\nmore\n";
  it("parses quotes with comments", () => {
    const h = parseHighlights(body);
    expect(h.map((x) => [x.quote, x.comment])).toEqual([["First quote\nline two", "my comment"], ["Second", undefined]]);
  });
  it("adds to the section, or makes one", () => {
    expect(parseHighlights(addHighlight(body, "Third", "why")).map((x) => x.quote)).toEqual(["First quote\nline two", "Second", "Third"]);
    expect(addHighlight(body, "Third")).toContain("> Third\n\n## After");
    expect(addHighlight("Notes\n", "Q")).toBe("Notes\n\n## Highlights\n\n> Q\n");
    expect(addHighlight("", "Q")).toBe("## Highlights\n\n> Q\n");
  });
  it("edits and removes", () => {
    const h = parseHighlights(body);
    expect(parseHighlights(replaceHighlight(body, h[0], "Changed", "c")).map((x) => [x.quote, x.comment])).toEqual([["Changed", "c"], ["Second", undefined]]);
    expect(parseHighlights(replaceHighlight(body, h[0], null)).map((x) => x.quote)).toEqual(["Second"]);
  });
});

describe("study paths", () => {
  it("parses and toggles steps", () => {
    const b = "Intro\n- [ ] [[Meditations]]: books 2–4\n- [x] Read SEP\n  - [ ] nested is ignored\n";
    const s = parseSteps(b);
    expect(s.map((x) => [x.done, x.link])).toEqual([[false, "Meditations"], [true, undefined]]);
    expect(parseSteps(toggleStep(b, 1))[0].done).toBe(true);
    expect(parseSteps(toggleStep(b, 2))[1].done).toBe(false);
  });
});

describe("index", () => {
  const files = {
    "Topics/Philosophy.md": "---\nicon: 🦉\ncolor: 7\n---\n",
    "Topics/Philosophy/Stoicism.md": "",
    "Topics/History.md": "",
    "Topics/History/Ancient History/Ancient Rome.md": "",
    "Resources/Meditations.md": '---\ntopics:\n  - "[[Stoicism]]"\n---\n',
    "Journal/2026/2026-11-21.md": "Thinking about [[Stoicism]] today. #history",
    "Notes/Loose.md": "Nothing here",
    "Notes/Rome.md": "#ancient-rome",
  };
  const x = ix(files);
  it("builds the topic tree and inherits icon/colour", () => {
    expect(x.topicOrder).toEqual(["History", "History/Ancient History/Ancient Rome", "Philosophy", "Philosophy/Stoicism"]);
    expect(x.topics.get("Philosophy/Stoicism")).toMatchObject({ parent: "Philosophy", icon: "🦉", color: 7, depth: 1 });
    // a folder that isn't a topic is skipped: Ancient Rome's parent is History
    expect(x.topics.get("History/Ancient History/Ancient Rome")?.parent).toBe("History");
  });
  it("puts items in topics by property, link and tag", () => {
    expect(x.topicsOf.get("Resources/Meditations.md")).toEqual(["Philosophy/Stoicism"]);
    expect(x.topicsOf.get("Journal/2026/2026-11-21.md")?.sort()).toEqual(["History", "Philosophy/Stoicism"]);
    expect(x.topicsOf.get("Notes/Rome.md")).toEqual(["History/Ancient History/Ancient Rome"]);
    expect(itemsIn(x, "Philosophy").map((d) => d.path).sort()).toEqual(["Journal/2026/2026-11-21.md", "Resources/Meditations.md"]);
    expect(itemsIn(x, "Philosophy", false)).toEqual([]);
  });
  it("resolves links and backlinks; inbox has unsorted notes only", () => {
    expect(resolve(x, "stoicism")).toBe("Topics/Philosophy/Stoicism.md");
    expect(resolve(x, "Philosophy/Stoicism")).toBe("Topics/Philosophy/Stoicism.md");
    expect(resolve(x, "Nope")).toBeUndefined();
    expect(x.backlinks.get("Topics/Philosophy/Stoicism.md")).toEqual(["Journal/2026/2026-11-21.md"]);
    expect(inbox(x).map((d) => d.path)).toEqual(["Notes/Loose.md"]);
  });
  it("the seed vault parses with every resource in a topic", () => {
    const s = ix(SEED);
    const resources = [...s.docs.values()].filter((d) => d.kind === "resource");
    expect(resources.length).toBeGreaterThan(15);
    expect(resources.filter((d) => !s.topicsOf.has(d.path)).map((d) => d.path)).toEqual([]);
    expect(inbox(s)).toEqual([]);
    expect(s.docs.get("Resources/Israel - A History.md")?.title).toBe("Israel: A History");
  });
});

describe("pins", () => {
  it("reads pinned: as a time, a date or true, and lists the most recently pinned first", () => {
    const v = ix({
      "Notes/Old.md": "---\npinned: 2026-11-20T09:00\n---\nold",
      "Notes/New.md": "---\npinned: 2026-11-25T16:30\n---\nnew",
      "Notes/Day.md": "---\npinned: 2026-11-22\n---\nday",
      "Notes/Plain.md": "---\npinned: true\n---\nplain",
      "Notes/Off.md": "---\npinned: false\n---\noff",
      "Notes/Junk.md": "---\npinned: soon\n---\njunk",
      "Notes/None.md": "nothing",
      "Topics/Dev.md": "---\npinned: true\n---\n",
      "Recipes/Soup.md": "---\npinned: 2026-11-21T10:00\n---\n## Ingredients\n- water",
    });
    expect(pinnedDocs(v).map((d) => d.title)).toEqual(["New", "Day", "Soup", "Old", "Plain"]);
    expect(v.docs.get("Notes/None.md")!.pinned).toBeUndefined();
    expect(v.docs.get("Topics/Dev.md")!.pinned).toBeUndefined();
  });
});
