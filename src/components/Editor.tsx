/* The Markdown editor: CodeMirror 6 (the engine Obsidian uses). Wraps lines, picks each line's
   direction from its text (Hebrew right-to-left), completes [[links]] and #tags, Markdown shortcuts
   (⌘B bold, ⌘I italic, ⌘K link), and saves as I type.

   `value` may change from outside (a sync brought an edit): it's applied unless it's text this editor
   produced itself, so a slow round trip never undoes typing. */
import { autocompletion, closeBrackets, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as ph, type KeyBinding } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { getIndex } from "../state/store";
import { slashSource } from "./editor/slash";

const style = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.3em" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.15em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: t.monospace, fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: ".9em" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--muted)" },
  { tag: t.list, color: "var(--muted)" },
]);

const theme = EditorView.theme({
  "&": { color: "var(--ink)", backgroundColor: "transparent", fontSize: "16px" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { fontFamily: "var(--font)", lineHeight: "1.6", padding: "4px 0", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft) !important" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-tooltip": { border: "0", borderRadius: "12px", background: "var(--raised)", boxShadow: "var(--shadow-lg)", overflow: "hidden" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "8px 12px !important", minHeight: "36px", display: "flex", alignItems: "center" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { background: "var(--accent-soft) !important", color: "var(--ink) !important" },
  ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal", marginLeft: "8px", fontSize: ".85em" },
  ".cm-wl": { color: "var(--accent)" },
  ".cm-tooltip-autocomplete": { maxWidth: "min(92vw, 380px)" },
  ".cm-tooltip-autocomplete > ul": { maxHeight: "min(50vh, 320px) !important", fontFamily: "var(--font) !important" },
  ".cm-completionSection": { padding: "8px 12px 4px !important", fontSize: ".75em", fontWeight: "650", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", border: "0 !important" },
  ".cm-completionLabel": { fontWeight: "550" },
});

/** [[ → note and topic names; # → tags. */
function complete(ctx: CompletionContext) {
  const link = ctx.matchBefore(/\[\[[^\]\n]*$/);
  if (link) {
    const ix = getIndex();
    const q = link.text.slice(2).toLowerCase();
    const options: Completion[] = [];
    for (const d of ix.docs.values()) {
      if (d.kind === "hub") continue;
      const label = d.name;
      if (q && !label.toLowerCase().includes(q) && !d.title.toLowerCase().includes(q)) continue;
      options.push({
        label, detail: d.kind === "topic" ? "topic" : d.kind === "resource" ? d.resource?.type : d.kind === "journal" ? "journal" : d.kind === "path" ? "path" : d.kind === "habit" ? "habit" : d.kind === "recipe" ? "recipe" : undefined,
        boost: d.kind === "topic" ? 2 : d.kind === "resource" ? 1 : 0,
        apply: (view, _c, from, to) => {
          const after = view.state.sliceDoc(to, to + 2);
          const insert = `[[${label}${after === "]]" ? "" : "]]"}`;
          view.dispatch({ changes: { from: from, to, insert }, selection: { anchor: from + insert.length + (after === "]]" ? 2 : 0) } });
        },
      });
      if (options.length > 300) break;
    }
    return { from: link.from, options, filter: false };
  }
  const tag = ctx.matchBefore(/(^|[\s(])#[\p{L}\p{N}_\-/]*$/u);
  if (tag && (tag.text.length > 1 || ctx.explicit)) {
    const at = tag.from + tag.text.indexOf("#");
    const ix = getIndex();
    const tags = new Set<string>([...ix.tags.keys()]);
    for (const id of ix.topicOrder) tags.add(ix.topics.get(id)!.name.toLowerCase().replace(/\s+/g, "-"));
    return { from: at, options: [...tags].map((x) => ({ label: "#" + x, type: "keyword" })), validFor: /^#[\p{L}\p{N}_\-/]*$/u };
  }
  return null;
}

function wrap(view: EditorView, mark: string) {
  view.dispatch(view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    return { changes: { from: r.from, to: r.to, insert: mark + text + mark }, range: EditorSelection.range(r.from + mark.length, r.to + mark.length) };
  }));
  return true;
}

const mdKeys: KeyBinding[] = [
  { key: "Mod-b", run: (v) => wrap(v, "**") },
  { key: "Mod-i", run: (v) => wrap(v, "*") },
  { key: "Mod-k", run: (v) => {
    v.dispatch(v.state.changeByRange((r) => {
      const text = v.state.sliceDoc(r.from, r.to);
      return { changes: { from: r.from, to: r.to, insert: `[[${text}]]` }, range: EditorSelection.cursor(r.to + 2 + (text ? 2 : 0)) };
    }));
    return true;
  } },
];

export function Editor({ value, onChange, placeholder, autoFocus, onBlur, label, onInsertReady, path }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; onBlur?: () => void; label?: string;
  /** the file being edited, for commands that need it (/sketch, templates' {{title}}) */
  path?: string;
  /** Gets a function that puts text on its own line at the cursor (null when the editor goes away). */
  onInsertReady?: (insert: ((text: string) => void) | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const mine = useRef<string[]>([value]);
  const cb = useRef({ onChange, onBlur });
  cb.current = { onChange, onBlur };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          closeBrackets(),
          keymap.of([...mdKeys, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(style),
          autocompletion({ override: [complete, slashSource({ path })], icons: false, maxRenderedOptions: 60 }),
          EditorView.lineWrapping,
          EditorView.perLineTextDirection.of(true),
          EditorView.contentAttributes.of({ "aria-label": label ?? "Note text", autocapitalize: "sentences", spellcheck: "true" }),
          ph(placeholder ?? ""),
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              const text = u.state.doc.toString();
              mine.current.push(text);
              if (mine.current.length > 30) mine.current.shift();
              cb.current.onChange(text);
            }
            if (u.focusChanged && !u.view.hasFocus) cb.current.onBlur?.();
          }),
        ],
      }),
    });
    view.current = v;
    if (autoFocus) { v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); }
    onInsertReady?.((text) => {
      const at = v.state.selection.main.head;
      const line = v.state.doc.lineAt(at);
      const before = at > line.from ? "\n" : "";
      const after = at < line.to || line.number < v.state.doc.lines ? "\n" : "";
      const insert = `${before}${text}${after || "\n"}`;
      v.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, scrollIntoView: true });
    });
    return () => { onInsertReady?.(null); v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || mine.current.includes(value) || v.state.doc.toString() === value) return;
    // changed elsewhere: take it, keeping the cursor about where it was
    const head = Math.min(v.state.selection.main.head, value.length);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, selection: { anchor: head } });
    mine.current = [value];
  }, [value]);

  return <div className="editor" ref={host} />;
}
