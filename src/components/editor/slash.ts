/* Slash commands: "/" at the start of a line or after a space opens a menu that filters as you type (by the command's
   names, then its title). Each one writes plain Markdown Obsidian reads the same way. The list (SLASH) is data, so the
   shortcuts sheet shows the same commands. Templates (the vault's Templates/ notes and the starters) are listed too. */
import { startCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { formatDate, fillTemplate } from "../../../shared/templates.ts";
import { todayISO } from "../../../shared/vault.ts";
import { addDays } from "../../lib/dates";
import { openSheet } from "../../lib/sheets";
import { getIndex } from "../../state/store";
import { templateText, templatesOf } from "../../state/templates";

export interface SlashCtx { path?: string; title?: string }
export interface SlashCommand {
  /** what you type after "/" (the first is shown) */
  names: string[];
  title: string;
  hint: string;
  group: "Blocks" | "Text" | "Dates" | "Insert" | "Claude";
  run: (view: EditorView, from: number, to: number, ctx: SlashCtx) => void;
}

// ── how commands write ────────────────────────────────────────

const PREFIX = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?|#{1,6} )?/;

/** Replace the line's own marker (list, task, heading, quote) with `prefix`, the "/command" taken out. */
function linePrefix(prefix: string) {
  return (view: EditorView, from: number, to: number) => {
    const line = view.state.doc.lineAt(from);
    const text = line.text.slice(0, from - line.from) + line.text.slice(to - line.from);
    const m = PREFIX.exec(text)!;
    const next = m[1] + prefix + text.slice(m[0].length).trimStart();
    view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, selection: { anchor: line.from + next.length }, scrollIntoView: true });
  };
}

/** Put `text` in place of the command; "¦" marks where the cursor goes. A block (`block`) gets its own lines. */
export function snippet(text: string, block = false) {
  return (view: EditorView, from: number, to: number) => {
    const line = view.state.doc.lineAt(from);
    const before = view.state.sliceDoc(line.from, from), after = view.state.sliceDoc(to, line.to);
    let insert = text;
    if (block) {
      if (before.trim()) insert = "\n\n" + insert; else if (line.number > 1 && view.state.doc.line(line.number - 1).text.trim()) insert = "\n" + insert;
      if (after.trim()) insert += "\n";
    }
    const at = insert.indexOf("¦");
    insert = insert.replace("¦", "");
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + (at < 0 ? insert.length : at) }, scrollIntoView: true });
  };
}

const time = () => formatDate(new Date(), "HH:mm");
const dayLink = (d: string) => `[[${d}]]`;

function footnote(view: EditorView, from: number, to: number) {
  const doc = view.state.doc.toString();
  const n = Math.max(0, ...[...doc.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]))) + 1;
  const end = view.state.doc.length - (to - from);
  const tail = doc.endsWith("\n\n") ? "" : doc.endsWith("\n") ? "\n" : "\n\n";
  const note = `${tail}[^${n}]: `;
  view.dispatch({
    changes: [{ from, to, insert: `[^${n}]` }, { from: view.state.doc.length, insert: note }],
    selection: EditorSelection.cursor(end + `[^${n}]`.length + note.length),
    scrollIntoView: true,
  });
}

const callout = (type: string) => snippet(`> [!${type}] ¦\n> `, true);

// ── the commands ──────────────────────────────────────────────

export const SLASH: SlashCommand[] = [
  { names: ["todo", "check", "task"], title: "Checkbox", hint: "- [ ] a task to tick", group: "Blocks", run: linePrefix("- [ ] ") },
  { names: ["h1", "heading"], title: "Heading 1", hint: "# Big heading", group: "Blocks", run: linePrefix("# ") },
  { names: ["h2"], title: "Heading 2", hint: "## Section", group: "Blocks", run: linePrefix("## ") },
  { names: ["h3"], title: "Heading 3", hint: "### Smaller section", group: "Blocks", run: linePrefix("### ") },
  { names: ["list", "bullet"], title: "Bullet list", hint: "- item", group: "Blocks", run: linePrefix("- ") },
  { names: ["num", "numbered"], title: "Numbered list", hint: "1. item", group: "Blocks", run: linePrefix("1. ") },
  { names: ["quote"], title: "Quote", hint: "> quoted text", group: "Blocks", run: linePrefix("> ") },
  { names: ["callout", "note"], title: "Callout: note", hint: "> [!note] a coloured box", group: "Blocks", run: callout("note") },
  { names: ["tip"], title: "Callout: tip", hint: "> [!tip]", group: "Blocks", run: callout("tip") },
  { names: ["info"], title: "Callout: info", hint: "> [!info]", group: "Blocks", run: callout("info") },
  { names: ["warning", "caution"], title: "Callout: warning", hint: "> [!warning]", group: "Blocks", run: callout("warning") },
  { names: ["question"], title: "Callout: question", hint: "> [!question]", group: "Blocks", run: callout("question") },
  { names: ["example"], title: "Callout: example", hint: "> [!example]", group: "Blocks", run: callout("example") },
  { names: ["table"], title: "Table", hint: "3 columns, a header and 2 rows", group: "Blocks", run: snippet("| ¦ |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n", true) },
  { names: ["code"], title: "Code block", hint: "``` fenced code ```", group: "Blocks", run: snippet("```\n¦\n```\n", true) },
  { names: ["divider", "hr", "line"], title: "Divider", hint: "--- a line across", group: "Blocks", run: snippet("---\n¦", true) },
  { names: ["highlight", "mark"], title: "Highlight", hint: "==marked text==", group: "Text", run: snippet("==¦==") },
  { names: ["bold"], title: "Bold", hint: "**bold** (⌘B)", group: "Text", run: snippet("**¦**") },
  { names: ["italic"], title: "Italic", hint: "*italic* (⌘I)", group: "Text", run: snippet("*¦*") },
  { names: ["strike"], title: "Strikethrough", hint: "~~struck out~~", group: "Text", run: snippet("~~¦~~") },
  { names: ["footnote"], title: "Footnote", hint: "[^1], its note at the end", group: "Text", run: footnote },
  { names: ["link"], title: "Link to a note", hint: "[[ and search", group: "Insert", run: (v, from, to) => { snippet("[[¦]]")(v, from, to); startCompletion(v); } },
  { names: ["sketch", "draw"], title: "Sketch", hint: "draw with the Pencil, put in here", group: "Insert", run: (v, from, to, c) => { v.dispatch({ changes: { from, to } }); if (c.path) openSheet({ kind: "sketch", note: c.path }); } },
  { names: ["today"], title: "Today's journal", hint: "[[today]], a link to it", group: "Dates", run: (v, f, t) => snippet(dayLink(todayISO()))(v, f, t) },
  { names: ["yesterday"], title: "Yesterday's journal", hint: "[[yesterday]]", group: "Dates", run: (v, f, t) => snippet(dayLink(addDays(todayISO(), -1)))(v, f, t) },
  { names: ["tomorrow"], title: "Tomorrow's journal", hint: "[[tomorrow]]", group: "Dates", run: (v, f, t) => snippet(dayLink(addDays(todayISO(), 1)))(v, f, t) },
  { names: ["date"], title: "Date", hint: "today, as text", group: "Dates", run: (v, f, t) => snippet(formatDate(new Date(), "D MMMM YYYY"))(v, f, t) },
  { names: ["time"], title: "Time", hint: "now, e.g. 14:30", group: "Dates", run: (v, f, t) => snippet(time())(v, f, t) },
  { names: ["now"], title: "Date and time", hint: "[[today]] 14:30", group: "Dates", run: (v, f, t) => snippet(`${dayLink(todayISO())} ${time()}`)(v, f, t) },
];

/** More commands from elsewhere (dictation, /ask): added once at start by the module that has them. */
export function addSlash(...c: SlashCommand[]) { for (const x of c) if (!SLASH.some((y) => y.names[0] === x.names[0])) SLASH.push(x); }

const GROUPS = ["Blocks", "Text", "Insert", "Dates", "Templates", "Claude"];
const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

/** The editor's completion source for "/". */
export function slashSource(ctx: SlashCtx) {
  return (cc: CompletionContext) => {
    const m = cc.matchBefore(/(?:^|[\s(])\/[\p{L}\p{N}-]*$/u);
    if (!m) return null;
    const from = m.from + m.text.indexOf("/");
    const q = m.text.slice(m.text.indexOf("/") + 1).toLowerCase();
    const opts: (Completion & { rank: number })[] = [];
    const rank = (names: string[], title: string) => {
      if (!q) return 1;
      if (names.some((n) => n === q)) return 4;
      if (names.some((n) => n.startsWith(q))) return 3;
      if (title.toLowerCase().split(/[\s:]+/).some((w) => w.startsWith(q))) return 2;
      return 0;
    };
    for (const c of SLASH) {
      const r = rank(c.names, c.title);
      if (!r) continue;
      opts.push({ label: "/" + c.names[0], displayLabel: c.title, detail: c.hint, section: c.group, rank: r, apply: (v, _c, f, t) => c.run(v, f, t, ctx) });
    }
    for (const t of templatesOf(getIndex())) {
      const names = ["template", slug(t.name)];
      const r = rank(names, t.name);
      if (!r) continue;
      opts.push({
        label: "/" + slug(t.name), displayLabel: t.name, detail: t.starter ? "starter template" : "template", section: "Templates", rank: r,
        apply: (v, _c, f, to) => {
          const title = ctx.title ?? (ctx.path ? getIndex().docs.get(ctx.path)?.title : undefined) ?? "";
          const body = fillTemplate(templateText(t), { title, now: new Date() }).body;
          snippet(body.trimEnd() + "\n¦", true)(v, f, to);
        },
      });
    }
    if (!opts.length) return null;
    opts.sort((a, b) => b.rank - a.rank);
    // grouped while nothing is typed; once something is, the best match first
    const sec = (s: Completion["section"]) => (q || typeof s !== "string" ? undefined : { name: s, rank: GROUPS.indexOf(s) });
    return { from, to: cc.pos, options: opts.map(({ rank: _r, ...o }, i) => ({ ...o, section: sec(o.section), boost: 99 - i })), filter: false };
  };
}
