import { describe, expect, it } from "vitest";
import { renderMarkdown, sectionOf } from "../src/lib/markdown.ts";

const env = { resolve: () => undefined };

describe("reading view markdown", () => {
  it("renders ==highlights== as <mark>, with markup inside", () => {
    expect(renderMarkdown("a ==big **idea**== here", env)).toContain("<mark>big <strong>idea</strong></mark>");
    expect(renderMarkdown("x == y == z", env)).not.toContain("<mark>");
  });
  it("renders Obsidian callouts: a class by type and the first line as the title", () => {
    const h = renderMarkdown("> [!warning] Careful\n> Hot pan.", env);
    expect(h).toContain('class="callout callout-warn"');
    expect(h).toContain('<span class="callout-title"><span class="callout-icon" aria-hidden="true"></span>Careful</span>');
    expect(h).toContain("Hot pan.");
    expect(renderMarkdown("> [!tip]\n> Text", env)).toContain("</span>Tip</span>");
    expect(renderMarkdown("> just a quote", env)).not.toContain("callout");
  });
});

describe("note embeds", () => {
  const notes: Record<string, string> = { Kant: "# Kant\n\n## Ethics\n\nAct only…\n\n- [ ] read\n\n## Life\n\nKönigsberg", Loop: "![[Loop]]" };
  const env2 = {
    resolve: (t: string) => (notes[t] != null ? `Notes/${t}.md` : undefined),
    embed: (t: string, h?: string) => { const b = notes[t]; if (b == null) return undefined; const x = h ? sectionOf(b, h) : b; return x == null ? undefined : { path: `Notes/${t}.md`, title: t, body: x }; },
  };
  it("shows a note's text, or one section, in a block with its tasks read-only", () => {
    const h = renderMarkdown("Before\n\n![[Kant#Ethics]]\n\nAfter", env2);
    expect(h).toMatch(/<div class="note-embed"><a class="embed-title wikilink" href="#doc\/[^"]*Kant[^"]*">Kant › Ethics<\/a>/);
    expect(h).toContain("Act only…");
    expect(h).not.toContain("Königsberg");
    expect(h).toContain('class="task-box" disabled');
    expect(h).not.toMatch(/<p[^>]*>\s*<div class="note-embed"/);
  });
  it("an embed inside a sentence stays a link, and embeds stop going deeper", () => {
    expect(renderMarkdown("see ![[Kant]] here", env2)).not.toContain("note-embed");
    const deep = renderMarkdown("![[Loop]]", { ...env2, self: "Notes/Other.md" });
    expect((deep.match(/note-embed/g) ?? []).length).toBe(2);
    expect(renderMarkdown("![[Loop]]", { ...env2, self: "Notes/Loop.md" })).not.toContain("note-embed");
  });
});
