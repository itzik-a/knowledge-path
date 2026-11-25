import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { cycleHeading, moveItem, toggleTask, wrap } from "../src/components/editor/commands.ts";

/** A fake view over `doc` with the cursor at "|" (or a selection between two "|"). */
function fake(doc: string) {
  const a = doc.indexOf("|"), b = doc.indexOf("|", a + 1);
  const text = doc.replace(/\|/g, "");
  const sel = b < 0 ? EditorSelection.cursor(a) : EditorSelection.range(a, b - 1);
  const v = { state: EditorState.create({ doc: text, selection: sel }), dispatch(...s: TransactionSpec[]) { v.state = v.state.update(...s).state; } };
  return v as unknown as EditorView & { state: EditorState };
}
const out = (v: EditorView) => { const s = v.state.doc.toString(), h = v.state.selection.main.head; return s.slice(0, h) + "|" + s.slice(h); };
const apply = (f: (v: EditorView) => boolean, doc: string) => { const v = fake(doc); f(v); return out(v); };

describe("editor commands", () => {
  it("toggleTask ticks a task, and makes a list item or a line a task", () => {
    expect(apply(toggleTask, "- [ ] milk|")).toBe("- [x] milk|");
    expect(apply(toggleTask, "  - [x] eggs|")).toBe("  - [ ] eggs|");
    expect(apply(toggleTask, "- bread|")).toBe("- [ ] bread|");
    expect(apply(toggleTask, "1. bread|")).toBe("- [ ] bread|");
    expect(apply(toggleTask, "salt|")).toBe("- [ ] salt|");
  });
  it("cycleHeading goes # → ## → ### → text", () => {
    expect(apply(cycleHeading, "Title|")).toBe("# Title|");
    expect(apply(cycleHeading, "## Title|")).toBe("### Title|");
    expect(apply(cycleHeading, "### Title|")).toBe("Title|");
    expect(apply(cycleHeading, "- item|")).toBe("# item|");
  });
  it("moveItem moves a list item with its sub-items past its neighbour", () => {
    const doc = "- a\n  - a1\n- b|\n  - b1\n- c";
    expect(apply(moveItem(-1), doc)).toBe("- b|\n  - b1\n- a\n  - a1\n- c");
    expect(apply(moveItem(1), doc)).toBe("- a\n  - a1\n- c\n- b|\n  - b1");
    expect(apply(moveItem(-1), "- a|\n- b")).toBe("- a|\n- b"); // first already
    expect(apply(moveItem(1), "- a\n  - x|\n  - y\n- b")).toBe("- a\n  - y\n  - x|\n- b"); // sub-items among themselves
  });
  it("wrap puts marks around the selection and keeps it selected", () => {
    const v = fake("a |word| b");
    wrap("**")(v);
    expect(v.state.doc.toString()).toBe("a **word** b");
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe("word");
  });
});
