import { describe, expect, it } from "vitest";
import { buildIndex, parseDoc, type Doc } from "../shared/index.ts";
import { cardKey, clozeParts, collectCards, isCloze, mergeCards, parseCards, reviewQueue, writeCards, type CardRec } from "../shared/cards.ts";

const ix = (files: Record<string, string>) => buildIndex(new Map(Object.entries(files).map(([p, c]) => [p, parseDoc(p, c)] as [string, Doc])));
const rec = (o: Partial<CardRec> = {}): CardRec => ({ src: "Resources/M.md", added: "2026-11-26", at: 1, ...o });
const srs = (due: number, state: 0 | 1 | 2 | 3 = 2) => ({ due, stability: 3, difficulty: 5, elapsed_days: 0, scheduled_days: 3, learning_steps: 0, reps: 1, lapses: 0, state });

describe("cards", () => {
  it("keys a highlight by its text, ignoring cloze marks and spacing", () => {
    expect(cardKey("The obstacle is the way")).toBe(cardKey("The ==obstacle== is  the\nway"));
    expect(cardKey("The obstacle is the way")).not.toBe(cardKey("The obstacle is a way"));
  });

  it("splits clozes", () => {
    expect(clozeParts("The ==obstacle== is the ==way==.")).toEqual([
      { text: "The " }, { text: "obstacle", hidden: true }, { text: " is the " }, { text: "way", hidden: true }, { text: "." },
    ]);
    expect(isCloze("no marks here")).toBe(false);
    expect(clozeParts("a == b")).toEqual([{ text: "a == b" }]);
  });

  it("reads and writes one card a line; bad files read as none", () => {
    const m = { b: rec(), a: rec({ srs: srs(5) }) };
    const text = writeCards(m);
    expect(text.split("\n")[2]).toMatch(/^ {4}"a": /);
    expect(parseCards(text)).toEqual(m);
    expect(parseCards("{oops")).toEqual({});
    expect(parseCards(writeCards({}))).toEqual({});
  });

  it("merges two devices card by card: the newer change wins, an edit beats a removal", () => {
    const base = writeCards({ a: rec(), b: rec(), c: rec() });
    const mine = writeCards({ a: rec({ at: 5, srs: srs(9) }), b: rec(), d: rec({ at: 3 }) }); // reviewed a, removed c, added d
    const theirs = writeCards({ a: rec({ at: 4, srs: srs(7) }), b: rec({ at: 6, srs: srs(8) }), c: rec({ at: 6, srs: srs(1) }) });
    expect(parseCards(mergeCards(base, mine, theirs))).toEqual({
      a: rec({ at: 5, srs: srs(9) }), b: rec({ at: 6, srs: srs(8) }), c: rec({ at: 6, srs: srs(1) }), d: rec({ at: 3 }),
    });
  });

  it("finds each card's highlight, even after the file was renamed; lost ones are reported", () => {
    const v = ix({ "Resources/Moved.md": "---\nurl: x\n---\n## Highlights\n\n> The ==obstacle== is the way\nMy comment\n" });
    const k = cardKey("The obstacle is the way");
    const { cards, lost } = collectCards(v, { [k]: rec(), gone: rec() });
    expect(cards).toHaveLength(1);
    expect(cards[0].path).toBe("Resources/Moved.md");
    expect(cards[0].h.comment).toBe("My comment");
    expect(lost).toEqual(["gone"]);
  });

  it("queues due cards (most overdue first) before new ones, new ones capped", () => {
    const c = (key: string, r: CardRec) => ({ key, rec: r, path: "", title: "", h: { quote: "", start: 0, end: 0 } });
    const q = reviewQueue([
      c("later", rec({ srs: srs(500) })), c("due2", rec({ srs: srs(50) })), c("due1", rec({ srs: srs(10) })),
      c("new2", rec({ added: "2026-11-27" })), c("new1", rec({ added: "2026-11-20" })), c("new3", rec({ added: "2026-11-28" })),
    ], 100, 2);
    expect(q.map((x) => x.key)).toEqual(["due1", "due2", "new1", "new2"]);
  });
});
