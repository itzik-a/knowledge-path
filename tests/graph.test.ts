import { describe, expect, it } from "vitest";
import { buildIndex, parseDoc, type Doc } from "../shared/index.ts";
import { buildGraph, DEFAULT_SHOW, frontmatterLinks, type Graph, type GraphShow } from "../shared/graph.ts";
import { forceTick, makeSim } from "../src/lib/force.ts";

const ix = (files: Record<string, string>) => buildIndex(new Map(Object.entries(files).map(([p, c]) => [p, parseDoc(p, c)] as [string, Doc])));
const ids = (g: Graph) => g.nodes.map((n) => n.id).sort();
const pairs = (g: Graph) => g.edges.map(([a, b]) => [g.nodes[a].id, g.nodes[b].id].sort().join(" — ")).sort();
const all: GraphShow = { topics: true, resources: true, journal: true, chapters: true, other: true, tags: true, missing: true, orphans: true };

const vault = ix({
  "Topics/Philosophy.md": "---\ncolor: 2\n---\n",
  "Topics/Philosophy/Stoicism.md": "",
  "Notes/A.md": "See [[B]] and [[B|again]], [[Nowhere]] and ![[Sketch 1.svg]]. #idea",
  "Notes/B.md": "---\ntopics:\n  - \"[[Stoicism]]\"\n---\nBack to [[A]].",
  "Notes/Lonely.md": "Nothing here.",
  "Resources/Meditations.md": "---\nurl: https://example.com\n---\nOn [[A]].",
  "Journal/2026/2026-11-26.md": "Read [[Meditations]].",
  "Books/Meditations/01 Book One.md": "---\nbook: \"[[Meditations]]\"\n---\nText.",
  "Templates/Daily.md": "Links [[A]].",
  ".hub/settings.json": "{}",
});

describe("graph", () => {
  it("reads links in frontmatter", () => {
    expect(frontmatterLinks({ topics: ["[[Stoicism]]", "[[Philosophy|P]]"], book: "[[Meditations#x]]", n: 3 })).toEqual(["Stoicism", "Philosophy", "Meditations"]);
  });

  it("makes a node per file and one edge per linked pair", () => {
    const g = buildGraph(vault, { show: DEFAULT_SHOW });
    expect(ids(g)).toEqual(["Journal/2026/2026-11-26.md", "Notes/A.md", "Notes/B.md", "Notes/Lonely.md", "Resources/Meditations.md", "Topics/Philosophy.md", "Topics/Philosophy/Stoicism.md"]);
    expect(pairs(g)).toEqual([
      "Journal/2026/2026-11-26.md — Resources/Meditations.md",
      "Notes/A.md — Notes/B.md",
      "Notes/A.md — Resources/Meditations.md",
      "Notes/B.md — Topics/Philosophy/Stoicism.md",
      "Topics/Philosophy.md — Topics/Philosophy/Stoicism.md",
    ]);
    const a = g.nodes.find((n) => n.id === "Notes/A.md")!;
    expect(a.degree).toBe(2);
    expect(g.nodes.find((n) => n.id === "Notes/B.md")!.topic).toBe("Philosophy");
    expect(a.topic).toBeUndefined(); // linking to a note in a topic doesn't put A in it
  });

  it("shows tags, missing notes and chapters when asked; never templates or app data", () => {
    const g = buildGraph(vault, { show: all });
    expect(ids(g)).toContain("tag:idea");
    expect(ids(g)).toContain("missing:nowhere");
    expect(ids(g)).not.toContain("missing:sketch 1.svg");
    expect(pairs(g)).toContain("Books/Meditations/01 Book One.md — Resources/Meditations.md");
    expect(ids(g).some((x) => x.startsWith("Templates/") || x.startsWith(".hub/"))).toBe(false);
  });

  it("drops a hidden kind with its links, and orphans when asked", () => {
    const g = buildGraph(vault, { show: { ...DEFAULT_SHOW, resources: false, orphans: false } });
    expect(ids(g)).not.toContain("Resources/Meditations.md");
    expect(ids(g)).not.toContain("Notes/Lonely.md");
    expect(ids(g)).not.toContain("Journal/2026/2026-11-26.md"); // only linked to the hidden resource
    for (const [a, b] of g.edges) { expect(g.nodes[a]).toBeTruthy(); expect(g.nodes[b]).toBeTruthy(); }
  });

  it("makes a local graph to a depth", () => {
    const one = buildGraph(vault, { show: DEFAULT_SHOW, local: { path: "Notes/B.md", depth: 1 } });
    expect(ids(one)).toEqual(["Notes/A.md", "Notes/B.md", "Topics/Philosophy/Stoicism.md"]);
    const two = buildGraph(vault, { show: DEFAULT_SHOW, local: { path: "Notes/B.md", depth: 2 } });
    expect(ids(two)).toEqual(["Notes/A.md", "Notes/B.md", "Resources/Meditations.md", "Topics/Philosophy.md", "Topics/Philosophy/Stoicism.md"]);
    expect(buildGraph(vault, { show: DEFAULT_SHOW, local: { path: "Notes/Lonely.md", depth: 2 } }).nodes).toHaveLength(1);
  });

  it("filters by search, keeping the links among what matches", () => {
    const g = buildGraph(vault, { show: DEFAULT_SHOW, search: "notes/" });
    expect(ids(g)).toEqual(["Notes/A.md", "Notes/B.md", "Notes/Lonely.md"]);
    expect(pairs(g)).toEqual(["Notes/A.md — Notes/B.md"]);
  });
});

describe("force layout", () => {
  it("pulls linked nodes together and pushes the rest apart", () => {
    const sim = makeSim(["a", "b", "c"], [[0, 1]]);
    for (let i = 0; i < 300; i++) forceTick(sim, { center: 0.1, repel: 1, link: 1, distance: 1 });
    const [a, b, c] = sim.nodes;
    const d = (p: typeof a, q: typeof a) => Math.hypot(p.x - q.x, p.y - q.y);
    expect(d(a, b)).toBeLessThan(d(a, c));
    expect(d(a, b)).toBeLessThan(d(b, c));
    for (const n of sim.nodes) { expect(Number.isFinite(n.x)).toBe(true); expect(Number.isFinite(n.y)).toBe(true); }
  });
  it("keeps where nodes were when the graph changes", () => {
    const sim = makeSim(["a", "b"], [[0, 1]]);
    for (let i = 0; i < 50; i++) forceTick(sim, { center: 0.1, repel: 1, link: 1, distance: 1 });
    const again = makeSim(["b", "c"], [], sim);
    expect(again.nodes[0].x).toBe(sim.nodes[1].x);
  });
});
