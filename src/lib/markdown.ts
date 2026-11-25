/* Markdown → HTML for reading views, Obsidian flavoured: [[wikilinks]] (to #doc/… or a "create it" link),
   #tags, task checkboxes that can be ticked, single line breaks kept, every block dir="auto" so Hebrew
   and English paragraphs each read the right way. Raw HTML in notes is not rendered (html: false). */
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import type { StateCore, StateInline, Token } from "markdown-it";
import { parseSketch, sketchMarkup } from "../../shared/sketch.ts";
import { parseLinkInner } from "../../shared/vault.ts";
import { docHref, tagHref } from "./route";

export interface MdEnv {
  resolve: (target: string) => string | undefined;
  /** What a link to this file says when it has no alias: a locked note's title (its file name is neutral). */
  title?: (path: string) => string | undefined;
  /** An embedded drawing: its path and SVG text, if the vault has it. */
  sketch?: (target: string) => { path: string; svg: string } | undefined;
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

// Footnotes ([^1] … [^1]: text), as Obsidian has them. The plugin's own links (#fn1, #fnref1) would be read
// as app routes, so the reference is a plain superscript and the notes are a numbered list at the end.
md.use(footnote);
md.renderer.rules.footnote_ref = (tokens: Token[], idx: number) => {
  const m = tokens[idx].meta as { id: number; subId: number; label?: string };
  return `<sup class="fn-ref">${esc(m.label ?? String(m.id + 1))}</sup>`;
};
md.renderer.rules.footnote_block_open = () => '<section class="footnotes" dir="auto"><ol class="footnotes-list">\n';
md.renderer.rules.footnote_open = (tokens: Token[], idx: number) => {
  const m = tokens[idx].meta as { id: number; label?: string };
  return `<li class="footnote-item" value="${Number(m.label) || m.id + 1}">`;
};
md.renderer.rules.footnote_anchor = () => "";

// [[target#heading|alias]] and ![[embed]]
md.inline.ruler.before("link", "wikilink", (state: StateInline, silent: boolean) => {
  const start = state.pos;
  const embed = state.src.charCodeAt(start) === 0x21; /* ! */
  const open = embed ? start + 1 : start;
  if (state.src.slice(open, open + 2) !== "[[") return false;
  const end = state.src.indexOf("]]", open + 2);
  if (end < 0) return false;
  const inner = state.src.slice(open + 2, end);
  if (!inner.trim() || inner.includes("\n") || inner.includes("[[")) return false;
  if (!silent) {
    const t = state.push("wikilink", "", 0);
    t.meta = { ...parseLinkInner(inner), embed };
  }
  state.pos = end + 2;
  return true;
});

// #tag (not a heading, not inside a word or URL, not all digits)
const TAG_AT = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u;
md.inline.ruler.after("wikilink", "hashtag", (state: StateInline, silent: boolean) => {
  if (state.src.charCodeAt(state.pos) !== 0x23) return false;
  const prev = state.pos > 0 ? state.src[state.pos - 1] : " ";
  if (!/[\s(,;]/.test(prev)) return false;
  const m = TAG_AT.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) {
    const t = state.push("hashtag", "", 0);
    t.meta = { tag: m[1].replace(/\/+$/, "") };
  }
  state.pos += m[0].length;
  return true;
});

const BLOCKS = new Set(["paragraph_open", "heading_open", "blockquote_open", "list_item_open", "table_open"]);

md.core.ruler.push("obsidian", (state: StateCore) => {
  const toks = state.tokens;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (BLOCKS.has(t.type)) t.attrSet("dir", "auto");
    // An Obsidian block id at the end of a paragraph ("… ^p12") is hidden, as Obsidian does, and kept as data-block.
    if (t.type === "inline" && toks[i - 1]?.type === "paragraph_open" && t.children?.length) {
      const last = t.children[t.children.length - 1];
      const m = last.type === "text" ? /\s\^([A-Za-z0-9-]+)$/.exec(last.content) : null;
      if (m) {
        last.content = last.content.slice(0, m.index);
        toks[i - 1].attrSet("data-block", m[1]);
      }
    }
    // - [ ] task / - [x] done
    if (t.type === "inline" && toks[i - 1]?.type === "paragraph_open" && toks[i - 2]?.type === "list_item_open") {
      const first = t.children?.[0];
      const m = first?.type === "text" ? /^\[([ xX])\]\s+/.exec(first.content) : null;
      if (first && m && t.children) {
        first.content = first.content.slice(m[0].length);
        const box = new state.Token("task_box", "", 0);
        box.meta = { checked: m[1] !== " ", line: toks[i - 2].map?.[0] ?? -1 };
        // the item's own text in a span, so a ticked item's strike-through doesn't reach its sub-items
        t.children = [box, new state.Token("task_text_open", "", 1), ...t.children, new state.Token("task_text_close", "", -1)];
        toks[i - 2].attrJoin("class", "task");
        if (m[1] !== " ") toks[i - 2].attrJoin("class", "done");
      }
    }
  }
});

const esc = (s: string) => md.utils.escapeHtml(s);

md.renderer.rules.wikilink = (tokens: Token[], idx: number, _o, envAny) => {
  const env = envAny as MdEnv | undefined;
  const { target, heading, alias, embed } = tokens[idx].meta as { target: string; heading?: string; alias?: string; embed: boolean };
  let label = alias ?? (heading ? `${target} › ${heading}` : target);
  if (embed && /\.svg$/i.test(target)) {
    const f = env?.sketch?.(target);
    const s = f && parseSketch(f.svg);
    if (f && s) return `<button type="button" class="sketch-embed" data-sketch="${esc(f.path)}" aria-label="Sketch: tap to draw on it">${sketchMarkup(s)}</button>`;
    // an SVG from elsewhere: shown as an image (an <img> never runs anything inside it)
    if (f) return `<img class="sketch-img" alt="${esc(alias ?? target)}" src="data:image/svg+xml;charset=utf-8,${esc(encodeURIComponent(f.svg))}">`;
  }
  if (embed && !/\.md$/i.test(target) && /\.[a-z0-9]{2,4}$/i.test(target)) return `<span class="embed-chip">📎 ${esc(target)}</span>`;
  const path = env?.resolve?.(target);
  const shown = path && !alias ? env?.title?.(path) : undefined;
  if (shown) label = heading ? `${shown} › ${heading}` : shown;
  if (path) return `<a class="wikilink" href="${esc(docHref(path))}">${esc(label)}</a>`;
  return `<a class="wikilink missing" href="#" data-create="${esc(target)}" title="Not written yet: tap to create">${esc(label)}</a>`;
};
md.renderer.rules.hashtag = (tokens: Token[], idx: number) => {
  const tag = (tokens[idx].meta as { tag: string }).tag;
  return `<a class="hashtag" href="${esc(tagHref(tag.toLowerCase()))}">#${esc(tag)}</a>`;
};
md.renderer.rules.task_box = (tokens: Token[], idx: number) => {
  const { checked, line } = tokens[idx].meta as { checked: boolean; line: number };
  return `<input type="checkbox" class="task-box" data-line="${line}"${checked ? " checked" : ""} aria-label="Done"> `;
};
md.renderer.rules.task_text_open = () => `<span class="task-text">`;
md.renderer.rules.task_text_close = () => `</span>`;
const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, self) => self.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const href = String(tokens[idx].attrGet("href") ?? "");
  if (/^https?:/i.test(href)) { tokens[idx].attrSet("target", "_blank"); tokens[idx].attrSet("rel", "noopener"); }
  return defaultLink(tokens, idx, opts, env, self);
};

export function renderMarkdown(body: string, env: MdEnv): string {
  return md.render(body, env as unknown as Record<string, unknown>);
}
