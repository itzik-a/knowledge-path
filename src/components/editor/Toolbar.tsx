/* The bar above the on-screen keyboard (iPhone and iPad): checkbox, list, heading, bold, italic, link, tag, slash,
   outdent / indent, undo / redo, the pen, find, Ask Claude and the mic (no Done: Safari's own bar under it hides the
   keyboard, and no web page can remove that bar). Only on a touch screen and while the editor
   has focus; it follows the keyboard with the visual viewport. Buttons keep the editor's focus (no blur on press).
   Extra buttons (dictation) come in through `extra`. */
import { startCompletion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openSheet } from "../../lib/sheets";
import { openSearchPanel } from "@codemirror/search";
import { canDictate, stopDictation, toggleDictation, useDictating } from "./dictation";
import { IconMic, IconSpark, IconSearch, IconCheckbox, IconIndent, IconList, IconOutdent, IconRedo, IconSketch, IconUndo } from "../Icons";
import { cycleHeading, indentLess, indentMore, linkSel, redo, toggleTask, undo, wrap } from "./commands";

/** Is this a touch screen (no fine pointer)? */
export const touchScreen = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** Where the visible area ends (the top of the keyboard), in the page's fixed coordinates. Read from the visual
   viewport alone: on iOS `innerHeight` shrinks with it when the keyboard opens, so "innerHeight minus the viewport"
   comes out 0 and the bar would sit behind the keyboard. Followed through the keyboard's slide-in with a few frames
   after each change, since iOS reports the size late. */
function useViewportBottom(): number | null {
  const [bottom, setBottom] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const read = () => setBottom(vv ? vv.offsetTop + vv.height : window.innerHeight);
    let frame = 0, until = 0;
    const follow = () => { read(); if (performance.now() < until) frame = requestAnimationFrame(follow); };
    const kick = () => { until = performance.now() + 700; cancelAnimationFrame(frame); follow(); };
    kick();
    vv?.addEventListener("resize", kick);
    vv?.addEventListener("scroll", read);
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("orientationchange", kick);
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", kick);
      vv?.removeEventListener("scroll", read);
      window.removeEventListener("scroll", read);
      window.removeEventListener("orientationchange", kick);
    };
  }, []);
  return bottom;
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
  const bottom = useViewportBottom();
  const bar = useRef<HTMLDivElement>(null);
  const h = bar.current?.offsetHeight ?? 44;
  const dictating = useDictating();
  // leaving the editor (Safari's own keyboard bar hides the keyboard) ends dictation too
  useEffect(() => () => stopDictation(), []);
  const run = (f: (v: EditorView) => unknown) => () => { f(view); if (view.contentDOM.isConnected && document.activeElement !== document.body) view.focus(); };
  const b = (label: string, f: (v: EditorView) => unknown, icon: ReactNode, cls = "") => (
    <button type="button" className={`kb-btn ${cls}`} aria-label={label} title={label}
      onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={run(f)}>{icon}</button>
  );
  return createPortal(
    <div ref={bar} className="kb-bar" role="toolbar" aria-label="Formatting"
      style={{ transform: `translateY(${(bottom ?? 0) - h}px)`, visibility: bottom == null ? "hidden" : undefined }}>
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
        {b("Find and replace", openSearchPanel, <IconSearch />)}
        {path && b("Ask Claude about this note", () => openSheet({ kind: "ask", path }), <IconSpark />)}
        {canDictate() && b(dictating ? "Stop dictating" : "Dictate", toggleDictation, <IconMic />, dictating ? "on" : "")}
        {extra}
      </div>
    </div>,
    document.body,
  );
}
