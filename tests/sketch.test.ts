/* Sketches: the SVG format, embeds in notes, syncing them, and merging two devices' strokes. */
import { describe, expect, it } from "vitest";
import {
  appendEmbed, HIGHLIGHT, INK, isSketchPath, mergeSketch, outlineToPath, parseSketch, removeEmbed, serializeSketch, sketchEmbeds,
  sketchMarkup, sketchName, strokeBottom, trimmedHeight, type Stroke,
} from "../shared/sketch.ts";
import { isSynced } from "../shared/vault.ts";
import { conflictPath } from "../src/lib/vaultsync.ts";

const a: Stroke = { d: "M10,10 Q20,20 30,30 T40,40 50,50 Z", fill: INK };
const b: Stroke = { d: "M100,200 Q110,210 120,220 T130,230 Z", fill: "#2A78D6" };
const hl: Stroke = { d: "M0,0 L10,0 L10,10 Z", fill: HIGHLIGHT, opacity: 0.35 };
const svg = (strokes: Stroke[], height = 400) => serializeSketch({ width: 1000, height, strokes });

describe("sketch files", () => {
  it("round-trips, one stroke per line, highlighter under the ink", () => {
    const text = svg([a, hl, b]);
    const lines = text.trim().split("\n");
    expect(lines[0]).toContain('data-sketch="knowledge-path"');
    expect(lines[0]).toContain('viewBox="0 0 1000 400"');
    expect(lines.slice(1, -1)).toHaveLength(3);
    expect(lines[1]).toContain(`fill="${HIGHLIGHT}"`);
    const back = parseSketch(text)!;
    expect(back).toMatchObject({ width: 1000, height: 400 });
    expect(back.strokes).toEqual([hl, a, b]);
  });

  it("only edits its own sketches, and lets nothing unsafe through", () => {
    expect(parseSketch('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0,0 L1,1"/></svg>')).toBeNull();
    const evil = svg([a]).replace("</svg>", '<path fill="#000" d="M0,0 L1,1" onload="alert(1)"/>\n<path fill="url(javascript:x)" d="M0,0 L1,1"/>\n<script>alert(1)</script>\n</svg>');
    const s = parseSketch(evil)!;
    expect(s.strokes).toHaveLength(2); // a, and the harmless path (its attributes are rebuilt)
    const html = sketchMarkup(s);
    expect(html).not.toMatch(/script|onload|javascript/);
    expect(html).toContain('fill="currentColor"'); // the default ink follows the theme
  });

  it("names, paths and sync", () => {
    expect(sketchName(new Date(2026, 10, 23, 14, 5, 9))).toBe("Sketch 2026-11-23 14.05.09.svg");
    expect(isSketchPath("Sketches/Sketch 1.svg")).toBe(true);
    expect(isSynced("Sketches/Sketch 1.svg")).toBe(true);
    expect(isSynced("Attachments/photo.png")).toBe(false);
    expect(isSynced(".hub/x.svg")).toBe(false);
    expect(conflictPath("Sketches/Sketch 1.svg", () => false, "2026-11-23")).toBe("Sketches/Sketch 1 (conflict 2026-11-23).svg");
    expect(conflictPath("Notes/A.md", () => false, "2026-11-23")).toBe("Notes/A (conflict 2026-11-23).md");
  });

  it("outline to path data, and the height trimmed to the drawing", () => {
    const d = outlineToPath([[0, 0], [10, 5], [20, 10], [30, 15.04], [40, 20]]);
    expect(d).toMatch(/^M0,0 Q10,5 15,7\.5 T25,12\.5 35,17\.5 Z$/);
    expect(outlineToPath([[1, 1]])).toBe("");
    expect(strokeBottom(b.d)).toBe(230);
    expect(trimmedHeight([a, b])).toBe(270);
    expect(trimmedHeight([a])).toBe(240); // never less than a small strip
  });
});

describe("embeds in notes", () => {
  it("finds, adds and removes ![[… .svg]]", () => {
    const body = "Intro\n\n![[Sketch 1.svg]]\n\nMore ![[Other.svg|300]] and [[Note]]\n";
    expect(sketchEmbeds(body)).toEqual(["Sketch 1.svg", "Other.svg"]);
    expect(removeEmbed(body, "Sketch 1.svg")).toBe("Intro\n\nMore ![[Other.svg|300]] and [[Note]]\n");
    expect(removeEmbed(body, "Other.svg")).toBe("Intro\n\n![[Sketch 1.svg]]\n\nMore  and [[Note]]\n");
    expect(appendEmbed("Text\n\n", "S.svg")).toBe("Text\n\n![[S.svg]]\n");
    expect(appendEmbed("", "S.svg")).toBe("![[S.svg]]\n");
  });
});

describe("two devices drew on the same sketch", () => {
  it("keeps what either drew and drops what either erased", () => {
    const c: Stroke = { d: "M300,300 L310,310 L300,320 Z", fill: INK };
    const base = svg([a, b]);
    const mine = svg([a, b, c], 500); // I drew c
    const theirs = svg([b, hl]);       // they erased a and highlighted
    const merged = parseSketch(mergeSketch(base, mine, theirs)!)!;
    expect(merged.strokes).toEqual([hl, b, c]);
    expect(merged.height).toBe(500);
  });
  it("leaves anything else to the text merge", () => {
    expect(mergeSketch("", "<svg/>", svg([a]))).toBeNull();
  });
});

describe("the lasso", () => {
  const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
  it("catches strokes mostly inside the loop", async () => {
    const { inLasso, inPolygon } = await import("../shared/sketch.ts");
    expect(inPolygon(50, 50, square)).toBe(true);
    expect(inPolygon(150, 50, square)).toBe(false);
    expect(inLasso("M10,10 L20,20 L30,10 Z", square)).toBe(true);
    expect(inLasso("M90,50 L95,50 L110,50 L120,50 L130,50 Z", square)).toBe(false); // 2 of 5 points inside
    expect(inLasso("M10,10 L20,20 Z", [[0, 0], [10, 10]])).toBe(false); // not a loop
  });
  it("moves strokes and boxes them", async () => {
    const { moveStroke, boundsOf } = await import("../shared/sketch.ts");
    const s = { d: "M10,10 Q20,20 30,30 T40,40 50,-5 Z", fill: INK };
    expect(moveStroke(s, 5, -2.5).d).toBe("M15,7.5 Q25,17.5 35,27.5 T45,37.5 55,-7.5 Z");
    expect(moveStroke(s, 0, 0)).toEqual(s);
    expect(boundsOf([s, b])).toEqual({ x: 10, y: -5, w: 120, h: 235 });
    expect(boundsOf([])).toBeNull();
  });
});
