/* Two devices and a fake GitHub: merges, conflicts, removals, the starter vault and an empty vault. */
import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEED } from "../shared/seed.ts";
import { parseCards, writeCards } from "../shared/cards.ts";
import { merge3, Moved, syncOnce, type Codec, type Head, type LocalStore, type Remote, type SyncState } from "../src/lib/vaultsync.ts";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

class FakeGitHub {
  blobs = new Map<string, string>();
  trees = new Map<string, Map<string, string>>();
  commits = new Map<string, { tree: string; parent?: string; message: string }>();
  head: string | null = null;
  calls = 0;
  /** Simulate someone pushing between our read and our write, once. */
  raceOnce?: () => void;
  /** Faults, once each: the commit never lands (no connection); it lands but the reply is lost (the app was
      closed, or the connection dropped mid-push); it lands but reading its tree back fails. */
  failCommitOnce = false;
  loseReplyOnce = false;
  failTreeAfterCommitOnce = false;
  private failTreeOnce = false;

  private putTree(files: Map<string, string>) {
    const sha = sha1(JSON.stringify([...files].sort()));
    this.trees.set(sha, new Map(files));
    return sha;
  }
  files(): Map<string, string> {
    if (!this.head) return new Map();
    const t = this.trees.get(this.commits.get(this.head)!.tree)!;
    return new Map([...t].map(([p, s]) => [p, this.blobs.get(s)!]));
  }
  /** A commit from somewhere else (Obsidian, the enricher). */
  push(changes: Record<string, string | null>, message = "elsewhere") {
    const cur = this.head ? new Map(this.trees.get(this.commits.get(this.head)!.tree)!) : new Map<string, string>();
    for (const [p, c] of Object.entries(changes)) {
      if (c == null) cur.delete(p);
      else { const s = sha1(c); this.blobs.set(s, c); cur.set(p, s); }
    }
    const tree = this.putTree(cur);
    const commit = randomUUID();
    this.commits.set(commit, { tree, parent: this.head ?? undefined, message });
    this.head = commit;
  }
  remote(): Remote {
    return {
      head: async (known) => {
        this.calls++;
        if (!this.head) this.push({ "README.md": "# vault\n" }, "Start the vault");
        if (known && known === this.head) return "unchanged";
        return { commit: this.head!, tree: this.commits.get(this.head!)!.tree };
      },
      tree: async (sha) => {
        this.calls++;
        if (this.failTreeOnce) { this.failTreeOnce = false; throw new Error("Not Found"); }
        return [...this.trees.get(sha)!].map(([path, s]) => ({ path, sha: s }));
      },
      blob: async (sha) => { this.calls++; return this.blobs.get(sha)!; },
      commit: async (parent: Head, changes, message) => {
        this.calls++;
        if (this.raceOnce) { const r = this.raceOnce; this.raceOnce = undefined; r(); }
        if (this.failCommitOnce) { this.failCommitOnce = false; throw new Error("Can't reach GitHub"); }
        if (parent.commit !== this.head) throw new Moved("moved");
        const cur = new Map(this.trees.get(parent.tree)!);
        for (const c of changes) {
          if (c.content == null) { if (!cur.has(c.path)) throw new Error(`delete of missing ${c.path}`); cur.delete(c.path); }
          else { const s = sha1(c.content); this.blobs.set(s, c.content); cur.set(c.path, s); }
        }
        const tree = this.putTree(cur);
        const commit = randomUUID();
        this.commits.set(commit, { tree, parent: parent.commit, message });
        this.head = commit;
        if (this.loseReplyOnce) { this.loseReplyOnce = false; throw new Error("The network connection was lost"); }
        if (this.failTreeAfterCommitOnce) { this.failTreeAfterCommitOnce = false; this.failTreeOnce = true; }
        return { commit, tree };
      },
    };
  }
}

type Store = typeof import("../src/state/store.ts");

async function device(codec?: Codec): Promise<{ s: Store; local: LocalStore; state: SyncState; sync: (gh: FakeGitHub) => Promise<Awaited<ReturnType<typeof syncOnce>>> }> {
  vi.resetModules();
  const s = (await import("../src/state/store.ts")) as Store;
  s.memoryOnly();
  await s.init();
  const local: LocalStore = { records: s.allRecords, get: s.getRecord, applyRemote: s.applyRemote, settle: s.settle, sending: s.markSent, add: (p, c) => s.writeFile(p, c) };
  const d = {
    s, local, state: {} as SyncState,
    async sync(gh: FakeGitHub) { const r = await syncOnce(gh.remote(), local, d.state, { codec }); d.state = r.state; return r; },
  };
  return d;
}

const dirtyCount = (s: Store) => s.allRecords().filter((r) => r.dirty).length;

describe("merge3", () => {
  it("merges changes to different lines, refuses clashing ones", () => {
    expect(merge3("a\nb\nc", "A\nb\nc", "a\nb\nC")).toBe("A\nb\nC");
    expect(merge3("a\nb\nc", "X\nb\nc", "Y\nb\nc")).toBeNull();
    expect(merge3("a", "b", "b")).toBe("b");
    // neighbouring lines, changed one each side
    expect(merge3("one\ntwo\nthree", "ONE\ntwo\nthree", "one\nTWO\nthree")).toBe("ONE\nTWO\nthree");
    // the same line changed both ways stays a conflict
    expect(merge3("one\ntwo", "ONE\ntwo", "Uno\nTWO")).toBeNull();
  });
  it("habit logs: days logged on both sides are both kept, only in habit files", () => {
    const base = "## Log\n\n- 2026-11-20\n";
    const mine = "## Log\n\n- 2026-11-22: 20 min\n- 2026-11-20\n";
    const theirs = "## Log\n\n- 2026-11-21: 15 min\n- 2026-11-20\n";
    expect(merge3(base, mine, theirs, { logs: true })).toBe("## Log\n\n- 2026-11-22: 20 min\n- 2026-11-21: 15 min\n- 2026-11-20\n");
    expect(merge3(base, mine, theirs)).toBeNull();
    // a clash in the text above the log is still a conflict
    expect(merge3("A\n## Log\n", "B\n## Log\n", "C\n## Log\n", { logs: true })).toBeNull();
  });
});

describe("sync", () => {
  let gh: FakeGitHub;
  beforeEach(() => {
    gh = new FakeGitHub();
    gh.push({ "README.md": "# vault\n", ".github/workflows/enrich.yml": "on: push\n", ...SEED }, "Starter vault");
  });

  it("first sync onto the starter vault matches every file without pulling or pushing", async () => {
    const a = await device();
    const r = await a.sync(gh);
    expect(r.pulled).toBe(0);
    expect(r.pushed).toBe(0);
    expect(dirtyCount(a.s)).toBe(0);
    expect(a.s.allRecords().every((x) => x.baseSha)).toBe(true);
    // README and the workflow aren't kept by the app
    expect(a.s.getRecord("README.md")).toBeUndefined();
    expect(r.other).toHaveProperty([".github/workflows/enrich.yml"]);
  });

  it("an edit made before connecting merges onto the vault", async () => {
    const a = await device();
    a.s.writeFile("Resources/Meditations.md", SEED["Resources/Meditations.md"] + "\nMy note.\n");
    const r = await a.sync(gh);
    expect(r.pushed).toBe(1);
    expect(gh.files().get("Resources/Meditations.md")).toContain("My note.");
    expect(dirtyCount(a.s)).toBe(0);
  });

  it("a starter file removed from the vault isn't brought back", async () => {
    gh.push({ "Resources/Sapiens.md": null });
    const a = await device();
    await a.sync(gh);
    expect(a.s.exists("Resources/Sapiens.md")).toBe(false);
    expect(gh.files().has("Resources/Sapiens.md")).toBe(false);
  });

  it("two devices: new files, edits to different lines merge, nothing re-downloaded needlessly", async () => {
    const a = await device(); await a.sync(gh);
    const b = await device(); await b.sync(gh);
    const p = "Topics/Philosophy.md";
    const base = a.s.readFile(p)!;
    a.s.writeFile(p, base.replace("better questions", "sharper questions"));
    a.s.writeFile("Notes/From A.md", "hello from A\n");
    await a.sync(gh);
    b.s.writeFile(p, base + "\n- Is there free will?\n");
    const before = gh.calls;
    const r = await b.sync(gh);
    expect(r.conflicts).toEqual([]);
    const merged = gh.files().get(p)!;
    expect(merged).toContain("sharper questions");
    expect(merged).toContain("Is there free will?");
    expect(b.s.readFile("Notes/From A.md")).toBe("hello from A\n");
    expect(gh.calls - before).toBeLessThan(10);
    await a.sync(gh);
    expect(a.s.readFile(p)).toBe(merged);
    // nothing new: a sync is one cheap call
    const c0 = gh.calls;
    const idle = await a.sync(gh);
    expect(idle.pulled + idle.pushed).toBe(0);
    expect(gh.calls - c0).toBe(1);
  });

  it("clashing edits keep both: the vault's copy keeps the name, mine goes beside it", async () => {
    const a = await device(); await a.sync(gh);
    const b = await device(); await b.sync(gh);
    const p = "Topics/History.md";
    const base = a.s.readFile(p)!;
    a.s.writeFile(p, base.replace("how things came to be", "AAA"));
    await a.sync(gh);
    b.s.writeFile(p, base.replace("how things came to be", "BBB"));
    const r = await b.sync(gh);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatch(/^Topics\/History \(conflict \d{4}-\d{2}-\d{2}\)\.md$/);
    expect(gh.files().get(p)).toContain("AAA");
    expect(gh.files().get(r.conflicts[0])).toContain("BBB");
    expect(b.s.readFile(p)).toContain("AAA");
  });

  it("removals: mine reaches the vault; an edit elsewhere beats my removal; a removal elsewhere removes here", async () => {
    const a = await device(); await a.sync(gh);
    const b = await device(); await b.sync(gh);
    const undo = a.s.removeFile("Resources/SPQR.md");
    expect(typeof undo).toBe("function");
    await a.sync(gh);
    expect(gh.files().has("Resources/SPQR.md")).toBe(false);
    expect(a.s.getRecord("Resources/SPQR.md")).toBeUndefined();
    await b.sync(gh);
    expect(b.s.exists("Resources/SPQR.md")).toBe(false);

    b.s.removeFile("Resources/Sapiens.md");
    gh.push({ "Resources/Sapiens.md": SEED["Resources/Sapiens.md"] + "edited in Obsidian\n" });
    await b.sync(gh);
    expect(b.s.readFile("Resources/Sapiens.md")).toContain("edited in Obsidian");
    expect(gh.files().has("Resources/Sapiens.md")).toBe(true);
  });

  it("bulk removal: one undo puts every file back; the removals reach the vault together", async () => {
    const a = await device(); await a.sync(gh);
    a.s.writeFile("Notes/Unsynced.md", "local only\n");
    const paths = ["Resources/SPQR.md", "Resources/Sapiens.md", "Notes/Unsynced.md"];
    const undo = a.s.removeFiles(paths);
    expect(paths.every((p) => !a.s.exists(p))).toBe(true);
    undo();
    expect(paths.every((p) => a.s.exists(p))).toBe(true);
    expect(a.s.getIndex().docs.has("Resources/SPQR.md")).toBe(true);
    a.s.removeFiles(paths);
    const before = gh.commits.size;
    await a.sync(gh);
    expect(gh.commits.size - before).toBe(1);
    const f = gh.files();
    expect(f.has("Resources/SPQR.md") || f.has("Resources/Sapiens.md") || f.has("Notes/Unsynced.md")).toBe(false);
    expect(dirtyCount(a.s)).toBe(0);
  });

  it("a rename moves the file and re-points links, on both sides", async () => {
    const a = await device(); await a.sync(gh);
    expect(a.s.renameFile("Resources/Meditations.md", "Resources/Meditations (Hays).md")).toBe(true);
    await a.sync(gh);
    const f = gh.files();
    expect(f.has("Resources/Meditations.md")).toBe(false);
    expect(f.get("Resources/Meditations (Hays).md")).toBe(SEED["Resources/Meditations.md"]);
    expect(f.get("Paths/Intro to Stoicism.md")).toContain("[[Meditations (Hays)]]");
  });

  it("a renamed topic takes its subtopics along", async () => {
    const a = await device(); await a.sync(gh);
    a.s.renameFile("Topics/History.md", "Topics/World History.md");
    await a.sync(gh);
    const f = gh.files();
    expect(f.has("Topics/World History/Ancient History/Ancient Rome.md")).toBe(true);
    expect([...f.keys()].filter((p) => p.startsWith("Topics/History"))).toEqual([]);
    expect(a.s.getIndex().topics.get("World History/Ancient History/Ancient Rome")?.parent).toBe("World History/Ancient History");
  });

  it("an edit made while the sync runs stays dirty and goes out next time", async () => {
    const a = await device(); await a.sync(gh);
    a.s.writeFile("Notes/Draft.md", "one\n");
    gh.raceOnce = () => a.s.writeFile("Notes/Draft.md", "one\ntwo\n");
    await a.sync(gh); // first attempt hits the race (our own edit, not a move), still commits "one"
    expect(dirtyCount(a.s)).toBe(1);
    await a.sync(gh);
    expect(gh.files().get("Notes/Draft.md")).toBe("one\ntwo\n");
    expect(dirtyCount(a.s)).toBe(0);
  });

  it("retries when the vault moves between reading and writing", async () => {
    const a = await device(); await a.sync(gh);
    a.s.writeFile("Notes/Mine.md", "mine\n");
    gh.raceOnce = () => gh.push({ "Notes/Theirs.md": "theirs\n" });
    await a.sync(gh);
    expect(gh.files().get("Notes/Mine.md")).toBe("mine\n");
    expect(a.s.readFile("Notes/Theirs.md")).toBe("theirs\n");
  });

  describe("a push that landed but this device never heard back", () => {
    const P = "Notes/Apps demo videos.md";

    it("a new note: the next sync knows its own push, no conflict copy", async () => {
      const a = await device(); await a.sync(gh);
      a.s.writeFile(P, "L");
      gh.loseReplyOnce = true;
      await expect(a.sync(gh)).rejects.toThrow();
      expect(gh.files().get(P)).toBe("L"); // it did reach the vault
      a.s.writeFile(P, "[Language path](https://example.com/1)\n[Knowledge hub](https://example.com/2)\n");
      const r = await a.sync(gh);
      expect(r.conflicts).toEqual([]);
      expect(r.pulled).toBe(0);
      expect(gh.files().get(P)).toBe(a.s.readFile(P));
      expect([...gh.files().keys()].filter((p) => p.includes("conflict"))).toEqual([]);
      expect(dirtyCount(a.s)).toBe(0);
    });

    it("an edit to the same line: mine goes out, no conflict copy", async () => {
      const a = await device(); await a.sync(gh);
      a.s.writeFile(P, "one\n"); await a.sync(gh);
      a.s.writeFile(P, "one two\n");
      gh.loseReplyOnce = true;
      await expect(a.sync(gh)).rejects.toThrow();
      a.s.writeFile(P, "one two three\n");
      const r = await a.sync(gh);
      expect(r.conflicts).toEqual([]);
      expect(gh.files().get(P)).toBe("one two three\n");
      expect(dirtyCount(a.s)).toBe(0);
    });

    it("a real edit elsewhere on top of it still merges or clashes as before", async () => {
      const a = await device(); await a.sync(gh);
      a.s.writeFile(P, "one\n"); await a.sync(gh);
      a.s.writeFile(P, "one two\n");
      gh.loseReplyOnce = true;
      await expect(a.sync(gh)).rejects.toThrow();
      gh.push({ [P]: "one TWO\n" }); // another device changed my pushed line
      a.s.writeFile(P, "one two three\n");
      const r = await a.sync(gh);
      expect(r.conflicts).toHaveLength(1);
      expect(gh.files().get(P)).toBe("one TWO\n");
      expect(gh.files().get(r.conflicts[0])).toBe("one two three\n");
    });

    it("removed afterwards: the removal reaches the vault", async () => {
      const a = await device(); await a.sync(gh);
      a.s.writeFile(P, "L");
      gh.loseReplyOnce = true;
      await expect(a.sync(gh)).rejects.toThrow();
      a.s.removeFile(P);
      const r = await a.sync(gh);
      expect(r.pulled).toBe(0);
      expect(gh.files().has(P)).toBe(false);
      expect(a.s.getRecord(P)).toBeUndefined();
      expect(dirtyCount(a.s)).toBe(0);
    });

    it("a push that never landed, then removed: nothing reaches the vault and nothing waits", async () => {
      const a = await device(); await a.sync(gh);
      a.s.writeFile(P, "L");
      gh.failCommitOnce = true;
      await expect(a.sync(gh)).rejects.toThrow();
      a.s.removeFile(P);
      await a.sync(gh);
      expect(gh.files().has(P)).toBe(false);
      expect(a.s.getRecord(P)).toBeUndefined();
      expect(dirtyCount(a.s)).toBe(0);
    });

    it("reading the new tree back fails: the push still counts, and the next sync finds nothing to merge", async () => {
      const a = await device(); await a.sync(gh);
      a.s.writeFile(P, "L");
      gh.failTreeAfterCommitOnce = true;
      const r1 = await a.sync(gh);
      expect(r1.pushed).toBe(1);
      expect(dirtyCount(a.s)).toBe(0);
      a.s.writeFile(P, "Language path\n");
      const r2 = await a.sync(gh);
      expect(r2.conflicts).toEqual([]);
      expect(gh.files().get(P)).toBe("Language path\n");
      expect(dirtyCount(a.s)).toBe(0);
      // and it can still be removed
      a.s.writeFile("Notes/Other.md", "x");
      gh.failTreeAfterCommitOnce = true;
      await a.sync(gh);
      a.s.removeFile("Notes/Other.md");
      await a.sync(gh);
      expect(gh.files().has("Notes/Other.md")).toBe(false);
      expect(dirtyCount(a.s)).toBe(0);
    });
  });

  it("two devices log the same habit before syncing: one file with both days, no conflict copy", async () => {
    const p = "Habits/Meditate.md";
    gh.push({ [p]: "---\nicon: 🧘\n---\n## Log\n\n- 2026-11-20\n" });
    const a = await device(); await a.sync(gh);
    const b = await device(); await b.sync(gh);
    a.s.writeFile(p, a.s.readFile(p)!.replace("## Log\n\n", "## Log\n\n- 2026-11-22\n"));
    b.s.writeFile(p, b.s.readFile(p)!.replace("## Log\n\n", "## Log\n\n- 2026-11-21: 10 min\n"));
    await a.sync(gh);
    const r = await b.sync(gh);
    expect(r.conflicts).toEqual([]);
    const want = "---\nicon: 🧘\n---\n## Log\n\n- 2026-11-22\n- 2026-11-21: 10 min\n- 2026-11-20\n";
    expect(gh.files().get(p)).toBe(want);
    await a.sync(gh);
    expect(a.s.readFile(p)).toBe(want);
  });

  it("two devices review different cards before syncing: .hub/cards.json merges card by card", async () => {
    const p = ".hub/cards.json";
    const rec = (at: number, reps = 0) => ({ src: "Notes/A.md", added: "2026-11-26", at, ...(reps ? { srs: { due: at, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps, lapses: 0, state: 2 as const } } : {}) });
    gh.push({ [p]: writeCards({ a: rec(1), b: rec(1) }) });
    const x = await device(); await x.sync(gh);
    const y = await device(); await y.sync(gh);
    x.s.writeFile(p, writeCards({ a: rec(5, 1), b: rec(1) }));
    y.s.writeFile(p, writeCards({ a: rec(1), b: rec(6, 1), c: rec(6) }));
    await x.sync(gh);
    const r = await y.sync(gh);
    expect(r.conflicts).toEqual([]);
    expect(parseCards(gh.files().get(p))).toEqual({ a: rec(5, 1), b: rec(6, 1), c: rec(6) });
  });

  it("an empty vault gets everything on this device", async () => {
    const empty = new FakeGitHub();
    const a = await device();
    a.s.writeFile("Notes/Before.md", "x\n");
    await a.sync(empty);
    const f = empty.files();
    expect(f.has("README.md")).toBe(true);
    expect(f.has("Resources/Meditations.md")).toBe(true);
    expect(f.get("Notes/Before.md")).toBe("x\n");
    expect(dirtyCount(a.s)).toBe(0);
  });
});

describe("sketches", () => {
  it("sync as files, and two devices drawing on one sketch keep both drawings (no conflict copy)", async () => {
    const { serializeSketch, parseSketch, INK } = await import("../shared/sketch.ts");
    const gh = new FakeGitHub();
    const p = "Sketches/Sketch 2026-11-23 10.00.00.svg";
    const s1 = { d: "M1,1 L2,2 L1,3 Z", fill: INK }, s2 = { d: "M5,5 L6,6 L5,7 Z", fill: INK }, s3 = { d: "M9,9 L8,8 L9,7 Z", fill: "#E34948" };
    const svg = (strokes: typeof s1[]) => serializeSketch({ width: 1000, height: 300, strokes });
    const a = await device(); await a.sync(gh);
    a.s.writeFile(p, svg([s1]));
    a.s.writeFile("Notes/Pic.md", "![[Sketch 2026-11-23 10.00.00.svg]]\n");
    await a.sync(gh);
    expect(gh.files().get(p)).toBe(svg([s1]));
    const b = await device(); await b.sync(gh);
    expect(b.s.readFile(p)).toBe(svg([s1]));
    a.s.writeFile(p, svg([s1, s2]));
    await a.sync(gh);
    b.s.writeFile(p, svg([s1, s3]));
    const r = await b.sync(gh);
    expect(r.conflicts).toEqual([]);
    expect(parseSketch(gh.files().get(p)!)!.strokes).toEqual([s1, s2, s3]);
    await a.sync(gh);
    expect(a.s.readFile(p)).toBe(gh.files().get(p));
  });
});

describe("private notes", () => {
  const P = "Notes/Diary.md";
  const note = '---\nprivate: true\ntopics: ["[[Philosophy]]"]\n---\nWhat I really think about [[Stoicism]] #secret\n';
  const codecWith = async (pass: { v: string }) => (await import("../shared/private.ts")).makeCodec(() => pass.v);

  it("go to the vault encrypted, come back readable with the passphrase, and stay sealed without it", async () => {
    const { isSealed } = await import("../shared/private.ts");
    const gh = new FakeGitHub();
    const a = await device(await codecWith({ v: "correct horse" })); await a.sync(gh);
    a.s.writeFile(P, note);
    a.s.writeFile("Notes/Open.md", "Plain\n");
    await a.sync(gh);
    const inVault = gh.files().get(P)!;
    expect(inVault).toMatch(/^---\nprivate: true\ntopics: \["\[\[Philosophy\]\]"\]\n---\n%%🔐γ [A-Za-z0-9+/=]+ 🔐%%\n$/u);
    expect(inVault).not.toContain("Stoicism");
    expect(gh.files().get("Notes/Open.md")).toBe("Plain\n");
    expect(a.s.readFile(P)).toBe(note); // this device keeps the plain text
    expect(dirtyCount(a.s)).toBe(0);

    const b = await device(await codecWith({ v: "correct horse" })); await b.sync(gh);
    expect(b.s.readFile(P)).toBe(note);
    expect(b.s.getIndex().docs.get(P)).toMatchObject({ private: true, tags: ["secret"] });

    const c = await device(await codecWith({ v: "" })); await c.sync(gh);
    expect(isSealed(c.s.readFile(P)!)).toBe(true);
    const doc = c.s.getIndex().docs.get(P)!;
    expect(doc).toMatchObject({ private: true, sealed: true, body: "", tags: [], links: [] });
    expect(doc.topicRefs).toEqual(["Philosophy"]); // its frontmatter still files it
  });

  it("edits merge on the plain text; a device without the passphrase can still change the frontmatter", async () => {
    const gh = new FakeGitHub();
    const a = await device(await codecWith({ v: "pw-12345" })); await a.sync(gh);
    a.s.writeFile(P, note); await a.sync(gh);
    const b = await device(await codecWith({ v: "pw-12345" })); await b.sync(gh);
    // both edit different lines before syncing: a three-way merge, no conflict copy
    a.s.writeFile(P, note.replace("What I really think", "What I think"));
    b.s.writeFile(P, note + "\nAnd more.\n");
    await a.sync(gh);
    const r = await b.sync(gh);
    expect(r.conflicts).toEqual([]);
    const both = note.replace("What I really think", "What I think") + "\nAnd more.\n";
    expect(b.s.readFile(P)).toBe(both);
    await a.sync(gh);
    expect(a.s.readFile(P)).toBe(both);

    // no passphrase: retopic it; the encrypted body goes back untouched, and a reads the change
    const c = await device(await codecWith({ v: "" })); await c.sync(gh);
    const sealed = c.s.readFile(P)!;
    c.s.writeFile(P, sealed.replace("[[Philosophy]]", "[[History]]"));
    const rc = await c.sync(gh);
    expect(rc.held).toEqual([]);
    await a.sync(gh);
    expect(a.s.readFile(P)).toBe(both.replace("[[Philosophy]]", "[[History]]"));
  });

  it("are never sent in the clear: without the passphrase a new private note waits", async () => {
    const gh = new FakeGitHub();
    const pass = { v: "" };
    const a = await device(await codecWith(pass)); await a.sync(gh);
    a.s.writeFile(P, note);
    a.s.writeFile("Notes/Open.md", "Plain\n");
    const r = await a.sync(gh);
    expect(r.held).toEqual([P]);
    expect(gh.files().has(P)).toBe(false);
    expect(gh.files().get("Notes/Open.md")).toBe("Plain\n");
    expect(a.s.getRecord(P)!.dirty).toBe(true);
    pass.v = "now I have one";
    const r2 = await a.sync(gh);
    expect(r2.held).toEqual([]);
    expect(gh.files().get(P)).toContain("%%🔐γ ");
    expect(dirtyCount(a.s)).toBe(0);
  });

  it("no longer private: back to plain text in the vault", async () => {
    const { setFrontmatter } = await import("../shared/vault.ts");
    const gh = new FakeGitHub();
    const a = await device(await codecWith({ v: "pw-12345" })); await a.sync(gh);
    a.s.writeFile(P, note); await a.sync(gh);
    a.s.writeFile(P, setFrontmatter(note, { private: undefined })); await a.sync(gh);
    expect(gh.files().get(P)).toBe(a.s.readFile(P));
    expect(gh.files().get(P)).toMatch(/^---\ntopics: .*Philosophy.*\n---\nWhat I really think about \[\[Stoicism\]\] #secret\n$/);
  });

  it("their sketches are encrypted too, and go back to plain when the note is unlocked", async () => {
    const { makeCodec, isPrivate, isSealedSketch } = await import("../shared/private.ts");
    const { serializeSketch, INK } = await import("../shared/sketch.ts");
    const { setFrontmatter } = await import("../shared/vault.ts");
    const gh = new FakeGitHub();
    const SK = "Sketches/Sketch 2026-11-23 20.00.00.svg";
    const svg = serializeSketch({ width: 1000, height: 300, strokes: [{ d: "M1,1 L2,2 L1,3 Z", fill: INK }] });
    let a: Awaited<ReturnType<typeof device>>;
    // locked: embedded in a locked note this device can read (what lockedSketches() works out in the app)
    a = await device(makeCodec(() => "pw-12345", (p) => p === SK && isPrivate(a.s.readFile(P) ?? "")));
    await a.sync(gh);
    a.s.writeFile(SK, svg);
    a.s.writeFile(P, note + "\n![[Sketch 2026-11-23 20.00.00.svg]]\n");
    await a.sync(gh);
    expect(isSealedSketch(gh.files().get(SK)!)).toBe(true);
    expect(gh.files().get(SK)).not.toContain("M1,1");
    expect(a.s.readFile(SK)).toBe(svg);

    const b = await device(makeCodec(() => "pw-12345")); await b.sync(gh);
    expect(b.s.readFile(SK)).toBe(svg);
    const c = await device(makeCodec(() => "")); await c.sync(gh);
    expect(isSealedSketch(c.s.readFile(SK)!)).toBe(true);

    // unlocking the note sends its sketch again (setPrivate marks it dirty), now plain
    a.s.writeFile(P, setFrontmatter(a.s.readFile(P)!, { private: undefined }));
    a.s.markDirty([SK]);
    await a.sync(gh);
    expect(gh.files().get(SK)).toBe(svg);
  });

  it("a locked note whose push landed unnoticed: no conflict copy", async () => {
    const gh = new FakeGitHub();
    const a = await device(await codecWith({ v: "pw-12345" })); await a.sync(gh);
    a.s.writeFile(P, note); await a.sync(gh);
    a.s.writeFile(P, note.replace("#secret", "#secret and"));
    gh.loseReplyOnce = true;
    await expect(a.sync(gh)).rejects.toThrow();
    a.s.writeFile(P, note.replace("#secret", "#secret and more"));
    const r = await a.sync(gh);
    expect(r.conflicts).toEqual([]);
    const b = await device(await codecWith({ v: "pw-12345" })); await b.sync(gh);
    expect(b.s.readFile(P)).toBe(note.replace("#secret", "#secret and more"));
  });

  it("a locked note's title travels encrypted and comes back exactly", async () => {
    const { makeCodec, withTitle } = await import("../shared/private.ts");
    const gh = new FakeGitHub();
    const LP = "Notes/Locked 0a1b2c3d.md";
    const text = withTitle(note, "My secret title");
    const a = await device(makeCodec(() => "pw-12345")); await a.sync(gh);
    a.s.writeFile(LP, text); await a.sync(gh);
    expect(gh.files().get(LP)).not.toContain("secret title");
    const b = await device(makeCodec(() => "pw-12345")); await b.sync(gh);
    expect(b.s.readFile(LP)).toBe(text);
    expect(b.s.getIndex().docs.get(LP)!.title).toBe("My secret title");
    expect(dirtyCount(b.s)).toBe(0);
  });
});
