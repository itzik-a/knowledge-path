/* Editing commands shared by the keyboard (keymap below), the toolbar above the on-screen keyboard and the shortcuts
   sheet (KEYS): wrapping a selection in a marker, ticking a task, cycling a heading, moving a list item with its
   sub-items, and typing a marker over a selection to wrap it. */
import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import { indentLess, indentMore, moveLineDown, moveLineUp, redo, undo } from "@codemirror/commands";
import { startCompletion } from "@codemirror/autocomplete";

type Cmd = (v: EditorView) => boolean;

/** Wrap each selection in `mark` (an empty one gets the pair with the cursor inside); the selection stays on the text. */
export const wrap = (mark: string, end = mark): Cmd => (view) => {
  view.dispatch(view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    return { changes: { from: r.from, to: r.to, insert: mark + text + end }, range: EditorSelection.range(r.from + mark.length, r.to + mark.length) };
  }));
  return true;
};

/** ⌘K: the selection as a [[link]] (empty: [[ ]] and the note search). */
export const linkSel: Cmd = (v) => {
  const empty = v.state.selection.main.empty;
  v.dispatch(v.state.changeByRange((r) => {
    const text = v.state.sliceDoc(r.from, r.to);
    return { changes: { from: r.from, to: r.to, insert: `[[${text}]]` }, range: EditorSelection.cursor(text ? r.to + 4 : r.from + 2) };
  }));
  if (empty) startCompletion(v);
  return true;
};

const TASK = /^(\s*)([-*+]) \[([ xX])\] /;
const ITEM = /^(\s*)([-*+]|\d+[.)]) /;

/** Each selected line: a task ticks or unticks, a list item or plain line becomes a task. */
export const toggleTask: Cmd = (view) => {
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const r of view.state.selection.ranges) {
    for (let n = view.state.doc.lineAt(r.from).number; n <= view.state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = view.state.doc.line(n);
      const t = TASK.exec(line.text);
      if (t) { const at = line.from + t[1].length + t[2].length + 2; changes.push({ from: at, to: at + 1, insert: t[3] === " " ? "x" : " " }); continue; }
      const i = ITEM.exec(line.text);
      if (i) { changes.push({ from: line.from + i[1].length, to: line.from + i[0].length, insert: "- [ ] " }); continue; }
      const ind = /^\s*/.exec(line.text)![0].length;
      changes.push({ from: line.from + ind, to: line.from + ind, insert: "- [ ] " });
    }
  }
  view.dispatch({ changes });
  return true;
};

/** The line's heading goes # → ## → ### → none (a list marker gives way to it). */
export const cycleHeading: Cmd = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const h = /^(#{1,6}) /.exec(line.text);
  const level = h ? h[1].length : 0;
  const rest = h ? line.text.slice(h[0].length) : line.text.replace(/^\s*(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)/, "");
  const next = level >= 3 ? rest : "#".repeat(level + 1) + " " + rest;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, selection: { anchor: line.from + next.length } });
  return true;
};

/** A line's list marker as typed, and its indent. */
const listOf = (text: string) => { const m = ITEM.exec(text); return m ? m[1].length : -1; };
const indentOf = (text: string) => /^\s*/.exec(text)![0].length;

/** Move the list item at the cursor, with its sub-items, past its neighbour (⌥↑ / ⌥↓); other lines move as lines. */
export const moveItem = (dir: -1 | 1): Cmd => (view) => {
  const doc = view.state.doc;
  const cur = doc.lineAt(view.state.selection.main.head);
  const ind = listOf(cur.text);
  if (ind < 0 || !view.state.selection.main.empty) return (dir < 0 ? moveLineUp : moveLineDown)(view);
  const child = (n: number) => n <= doc.lines && doc.line(n).text.trim() !== "" && indentOf(doc.line(n).text) > ind;
  const end = (n: number) => { let e = n + 1; while (child(e)) e++; return e; }; // first line after the item
  let a: number, b: number, c: number; // two blocks [a, b) and [b, c), swapped
  if (dir > 0) {
    a = cur.number; b = end(a);
    if (b > doc.lines || listOf(doc.line(b).text) !== ind) return true;
    c = end(b);
  } else {
    b = cur.number; c = end(b);
    let p = b - 1;
    while (p >= 1 && child(p)) p--;
    if (p < 1 || listOf(doc.line(p).text) !== ind) return true;
    a = p;
  }
  const text = (x: number, y: number) => doc.sliceString(doc.line(x).from, doc.line(y - 1).to);
  const first = text(a, b), second = text(b, c);
  const from = doc.line(a).from, to = doc.line(c - 1).to;
  const col = view.state.selection.main.head - cur.from;
  const moved = second + "\n" + first;
  // where the cursor's line ends up: the moved block is `first` when going down, `second` when going up
  const startOfMine = dir > 0 ? from + second.length + 1 : from;
  view.dispatch({ changes: { from, to, insert: moved }, selection: { anchor: startOfMine + col }, scrollIntoView: true });
  return true;
};

/** Typing a marker with text selected wraps the text (twice * makes bold); = and ~ wrap in == and ~~. */
const PAIRS: Record<string, [string, string]> = { "*": ["*", "*"], _: ["_", "_"], "`": ["`", "`"], "=": ["==", "=="], "~": ["~~", "~~"] };
export const wrapOnType: Extension = EditorView.inputHandler.of((view, _from, _to, text) => {
  const p = PAIRS[text];
  if (!p || view.state.selection.ranges.every((r) => r.empty)) return false;
  return wrap(p[0], p[1])(view);
});

export const done: Cmd = (v) => { v.contentDOM.blur(); return true; };

export const keys: KeyBinding[] = [
  { key: "Mod-b", run: wrap("**") },
  { key: "Mod-i", run: wrap("*") },
  { key: "Mod-Shift-x", run: wrap("~~") },
  { key: "Mod-Shift-h", run: wrap("==") },
  { key: "Mod-k", run: linkSel },
  { key: "Mod-Enter", run: toggleTask },
  { key: "Mod-Alt-1", run: (v) => setHeading(v, 1) },
  { key: "Mod-Alt-2", run: (v) => setHeading(v, 2) },
  { key: "Mod-Alt-3", run: (v) => setHeading(v, 3) },
  { key: "Mod-Alt-0", run: (v) => setHeading(v, 0) },
  { key: "Alt-ArrowUp", run: moveItem(-1) },
  { key: "Alt-ArrowDown", run: moveItem(1) },
];

function setHeading(view: EditorView, level: number) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const rest = line.text.replace(/^#{1,6} /, "");
  const next = (level ? "#".repeat(level) + " " : "") + rest;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, selection: { anchor: line.from + next.length } });
  return true;
}

export { indentLess, indentMore, redo, undo };

/** The editor's shortcuts, for the shortcuts sheet (the keys above, and what CodeMirror and the app already do). */
export const EDITOR_KEYS: { keys: string; what: string }[] = [
  { keys: "⌘B", what: "Bold" },
  { keys: "⌘I", what: "Italic" },
  { keys: "⌘⇧X", what: "Strikethrough" },
  { keys: "⌘⇧H", what: "Highlight" },
  { keys: "⌘K", what: "Link the selection to a note (or search notes)" },
  { keys: "⌘↩", what: "Tick or untick a task; make the line a task" },
  { keys: "⌘⌥1 / 2 / 3", what: "Heading 1, 2, 3 (⌘⌥0 back to text)" },
  { keys: "⌥↑ / ⌥↓", what: "Move the list item (with its sub-items) or the line up or down" },
  { keys: "Tab / ⇧Tab", what: "Indent or outdent the line" },
  { keys: "↩ in a list", what: "Next item (twice ends the list)" },
  { keys: "⌘Z / ⌘⇧Z", what: "Undo / redo" },
  { keys: "⌘F", what: "Find in the note; ⌘⌥F find and replace" },
  { keys: "* _ = ~ `", what: "Typed over selected text: wraps it (* twice: bold)" },
  { keys: "/", what: "Slash commands" },
  { keys: "[[", what: "Link a note or topic" },
  { keys: "#", what: "A tag" },
];
