/* A note's outline (its headings, outside code blocks) as a menu: jump to one, in the editor or the reading view.
   And the word count shown under the editor. */
import { gotoInEditor } from "../../lib/insert";
import { IconOutline } from "../Icons";
import { Menu } from "../ui";

export interface Heading { level: number; text: string; line: number }

export function headingsOf(body: string): Heading[] {
  const out: Heading[] = [];
  let fence = false;
  body.split("\n").forEach((l, line) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    const m = !fence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (m && m[2]) out.push({ level: m[1].length, text: m[2].replace(/[*_`=~]|\[\[|\]\]/g, ""), line });
  });
  return out;
}

/** Words (letters or digits, Hebrew too) in a body, leaving out markup, link targets and code fences' markers. */
export function countWords(body: string): number {
  const text = body
    .replace(/^\s*(```|~~~).*$/gm, " ")
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, " $2 ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/https?:\/\/\S+/g, " ");
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0;
}

export function WordCount({ body }: { body: string }) {
  const n = countWords(body);
  if (!n) return null;
  const min = Math.max(1, Math.round(n / 230));
  return <p className="word-count muted small" aria-live="off">{n.toLocaleString("en-GB")} {n === 1 ? "word" : "words"} · {min} min read</p>;
}

/** The outline button (only with two headings or more). In the reading view it scrolls to the heading. */
export function OutlineButton({ path, body, editing }: { path: string; body: string; editing: boolean }) {
  const hs = headingsOf(body);
  if (hs.length < 2) return null;
  const top = Math.min(...hs.map((h) => h.level));
  const jump = (h: Heading, i: number) => {
    if (editing && gotoInEditor(path, h.line)) return;
    const els = [...document.querySelectorAll<HTMLElement>(".note-card-main .prose :is(h1,h2,h3,h4,h5,h6)")].filter((e) => !e.closest(".note-embed"));
    els[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <Menu label="Outline" icon={<IconOutline />} items={hs.map((h, i) => ({ label: " ".repeat(h.level - top) + h.text, run: () => jump(h, i) }))} />
  );
}
