import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { SLASH } from "../src/components/editor/slash.ts";

/** Enough of an EditorView for the commands: state and dispatch. */
function fake(doc: string) {
  const v = { state: EditorState.create({ doc }), dispatch(...s: TransactionSpec[]) { v.state = v.state.update(...s).state; } };
  return v as unknown as EditorView & { state: EditorState };
}
/** Run "/name" typed at the "|" in `doc`; the result with "|" at the cursor. */
function run(name: string, doc: string) {
  const at = doc.indexOf("|");
  const text = doc.replace("|", `/${name}`);
  const v = fake(text);
  SLASH.find((c) => c.names.includes(name))!.run(v, at, at + name.length + 1, {});
  const s = v.state.doc.toString(), h = v.state.selection.main.head;
  return s.slice(0, h) + "|" + s.slice(h);
}

describe("slash commands", () => {
  it("line markers replace the line's own marker", () => {
    expect(run("todo", "buy milk |")).toBe("- [ ] buy milk |");
    expect(run("h2", "- an item|")).toBe("## an item|");
    expect(run("quote", "  - [ ] nested|")).toBe("  > nested|");
  });
  it("blocks get their own lines, the cursor inside", () => {
    expect(run("code", "Intro\n|")).toBe("Intro\n\n```\n|\n```\n");
    expect(run("tip", "|")).toBe("> [!tip] |\n> ");
    expect(run("divider", "Text\n|")).toBe("Text\n\n---\n|");
  });
  it("inline snippets wrap the cursor", () => {
    expect(run("highlight", "a |b")).toBe("a ==|==b");
  });
  it("footnotes take the next number and put the note at the end", () => {
    expect(run("footnote", "One[^1] two| three\n\n[^1]: first\n")).toBe("One[^1] two[^2] three\n\n[^1]: first\n\n[^2]: |");
  });
});
