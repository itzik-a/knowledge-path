/* The bar above the on-screen keyboard (iPhone and iPad): checkbox, list, heading, bold, italic, link, tag, slash,
   outdent / indent, undo / redo, the pen, and Done (hides the keyboard). Only on a touch screen and while the editor
   has focus; it follows the keyboard with the visual viewport. Buttons keep the editor's focus (no blur on press).
   Extra buttons (dictation) come in through `extra`. */
import { startCompletion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openSheet } from "../../lib/sheets";
import { IconCheckbox, IconIndent, IconKeyboardDown, IconList, IconOutdent, IconRedo, IconSketch, IconUndo } from "../Icons";
import { cycleHeading, done, indentLess, indentMore, linkSel, redo, toggleTask, undo, wrap } from "./commands";

/** Is this a touch screen (no fine pointer)? */
export const touchScreen = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** How far the keyboard covers the bottom of the window, in px. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const f = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    f();
    vv.addEventListener("resize", f);
    vv.addEventListener("scroll", f);
    return () => { vv.removeEventListener("resize", f); vv.removeEventListener("scroll", f); };
  }, []);
  return inset;
}

/** Type text at the cursor (a space first after a word), then maybe open the completion menu. */
function type(view: EditorView, text: string, after = "", complete = false) {
  const r = view.state.selection.main;
  const prev = view.state.sliceDoc(r.from - 1, r.from);
  const space = prev && !/\s|\(/.test(prev) && text !== "[[" ? " " : "";
  view.dispatch({ changes: { from: r.from, to: r.to, insert: space + text + after }, selection: { anchor: r.from + space.length + text.length } });
  if (complete) startCompletion(view);
}

export function Toolbar({ view, path, extra }: { view: EditorView; path?: string; extra?: ReactNode }) {
  const inset = useKeyboardInset();
  const run = (f: (v: EditorView) => unknown) => () => { f(view); if (f !== done) view.focus(); };
  const b = (label: string, f: (v: EditorView) => unknown, icon: ReactNode, cls = "") => (
    <button type="button" className={`kb-btn ${cls}`} aria-label={label} title={label}
      onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={run(f)}>{icon}</button>
  );
  return createPortal(
    <div className="kb-bar" role="toolbar" aria-label="Formatting" style={{ bottom: inset }}>
      <div className="kb-scroll">
        {b("Checkbox", toggleTask, <IconCheckbox />)}
        {b("Bullet list", (v) => { const l = v.state.doc.lineAt(v.state.selection.main.head); if (!/^\s*[-*+] /.test(l.text)) v.dispatch({ changes: { from: l.from, insert: "- " } }); }, <IconList />)}
        {b("Heading (tap again for smaller)", cycleHeading, <span className="kb-txt">H</span>)}
        {b("Bold", wrap("**"), <span className="kb-txt b">B</span>)}
        {b("Italic", wrap("*"), <span className="kb-txt i">I</span>)}
        {b("Link a note", linkSel, <span className="kb-txt">[[</span>)}
        {b("Tag", (v) => type(v, "#", "", true), <span className="kb-txt">#</span>)}
        {b("Slash commands", (v) => type(v, "/", "", true), <span className="kb-txt">/</span>)}
        {b("Outdent", indentLess, <IconOutdent />)}
        {b("Indent", indentMore, <IconIndent />)}
        {b("Undo", undo, <IconUndo />)}
        {b("Redo", redo, <IconRedo />)}
        {path && b("Sketch", () => openSheet({ kind: "sketch", note: path }), <IconSketch />)}
        {extra}
      </div>
      {b("Done: hide the keyboard", done, <IconKeyboardDown />, "kb-done")}
    </div>,
    document.body,
  );
}
