// Bulk actions on selected items (src/state/bulk.ts), against the store kept in memory.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { splitFrontmatter, strList } from "../shared/vault.ts";

const noop = () => {};
vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval, addEventListener: noop, removeEventListener: noop, dispatchEvent: noop });
vi.stubGlobal("document", { addEventListener: noop, removeEventListener: noop, visibilityState: "visible", documentElement: { classList: { add: noop, remove: noop } } });
vi.stubGlobal("location", { hash: "" });
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

type Store = typeof import("../src/state/store.ts");
type Bulk = typeof import("../src/state/bulk.ts");
type Toast = typeof import("../src/lib/toast.ts");
let s: Store, b: Bulk, toast: Toast;

const fm = (path: string) => splitFrontmatter(s.readFile(path) ?? "").fm;
const undo = () => { const t = toast.currentToast(); expect(t?.action?.label).toBe("Undo"); t!.action!.run(); };

beforeEach(async () => {
  vi.resetModules();
  s = await import("../src/state/store.ts");
  s.memoryOnly();
  s.noStamps();
  await s.init();
  b = await import("../src/state/bulk.ts");
  toast = await import("../src/lib/toast.ts");
  s.writeFiles([
    { path: "Topics/History.md", content: "---\nicon: 🏛️\n---\n" },
    { path: "Topics/History/Ancient History.md", content: "" },
    { path: "Resources/SPQR.md", content: "---\ntype: book\nstatus: saved\nsuggested: true\ntopics:\n  - \"[[Ancient History]]\"\n---\n" },
    { path: "Resources/1491.md", content: "---\ntype: book\nstatus: next\n---\n" },
    { path: "Notes/Idea.md", content: "---\ncreated: 2026-11-27\n---\nAbout [[SPQR]]\n" },
    { path: "Notes/Other.md", content: "Text\n" },
  ]);
});

describe("bulk actions", () => {
  it("sets the status of saved links, skipping notes and ones already there, with one Undo", () => {
    expect(b.bulkStatus(["Resources/SPQR.md", "Resources/1491.md", "Notes/Idea.md"], "next")).toBe(1);
    expect(fm("Resources/SPQR.md").status).toBe("next");
    expect(fm("Resources/SPQR.md").suggested).toBeUndefined();
    undo();
    expect(fm("Resources/SPQR.md")).toMatchObject({ status: "saved", suggested: true });
  });

  it("adds a topic once and removes only what's in the property", () => {
    expect(b.bulkTopic(["Resources/SPQR.md", "Resources/1491.md", "Notes/Other.md"], "History", true)).toBe(3);
    expect(strList(fm("Resources/SPQR.md").topics)).toEqual(["[[Ancient History]]", "[[History]]"]);
    expect(b.bulkTopic(["Resources/SPQR.md"], "History", true)).toBe(0); // already there
    expect(b.bulkTopic(["Resources/SPQR.md", "Resources/1491.md"], "History/Ancient History", false)).toBe(1);
    expect(strList(fm("Resources/SPQR.md").topics)).toEqual(["[[History]]"]);
  });

  it("pins and unpins, and keeps Inbox items out", () => {
    expect(b.bulkPin(["Notes/Idea.md", "Notes/Other.md"], true)).toBe(2);
    expect(typeof fm("Notes/Other.md").pinned).toBe("string");
    expect(b.bulkPin(["Notes/Idea.md", "Notes/Other.md"], false)).toBe(2);
    expect(fm("Notes/Other.md").pinned).toBeUndefined();
    expect(b.bulkKeepOut(["Notes/Other.md"])).toBe(1);
    expect(fm("Notes/Other.md").inbox).toBe(false);
  });

  it("makes a study path in the given order, with the topic they share, and adds to one without repeats", () => {
    const f = b.bulkToPath(["Resources/1491.md", "Resources/SPQR.md"], { title: "Rome and the Americas" })!;
    expect(f).toBe("Paths/Rome and the Americas.md");
    expect(splitFrontmatter(s.readFile(f)!).body).toBe("- [ ] [[1491]]\n- [ ] [[SPQR]]\n");
    b.bulkToPath(["Resources/SPQR.md", "Notes/Idea.md"], { path: f });
    expect(splitFrontmatter(s.readFile(f)!).body).toBe("- [ ] [[1491]]\n- [ ] [[SPQR]]\n- [ ] [[Idea]]\n");
    undo();
    expect(splitFrontmatter(s.readFile(f)!).body).toBe("- [ ] [[1491]]\n- [ ] [[SPQR]]\n");
    // a roadmap in stages gets them as a stage of their own
    s.writeFile("Paths/Road.md", "## Stage 1\n- [ ] [[1491]]\n");
    b.bulkToPath(["Notes/Idea.md"], { path: "Paths/Road.md" });
    expect(s.readFile("Paths/Road.md")).toMatch(/^## Stage 1\n- \[ \] \[\[1491\]\]\n\n## Added \d{4}-\d{2}-\d{2}\n- \[ \] \[\[Idea\]\]\n$/);
  });

  it("moves notes into a folder and back with Undo; links follow by name", () => {
    expect(b.bulkMove(["Notes/Idea.md", "Notes/Other.md", "Resources/SPQR.md"], "Notes/Ideas")).toBe(2);
    expect(s.exists("Notes/Ideas/Idea.md")).toBe(true);
    expect(s.exists("Notes/Idea.md")).toBe(false);
    undo();
    expect(s.exists("Notes/Idea.md")).toBe(true);
    expect(b.noteFolders()[0]).toBe("Notes");
  });

  it("knows what a selection can do", () => {
    expect(b.bulkKinds(["Resources/SPQR.md"])).toMatchObject({ resources: true, movable: false, lockable: false });
    expect(b.bulkKinds(["Notes/Idea.md", "Journal/2026/2026-11-27.md"])).toMatchObject({ resources: false, movable: false, lockable: true });
    expect(b.bulkKinds([])).toMatchObject({ resources: false, topical: false });
  });
});
