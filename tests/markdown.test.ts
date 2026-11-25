import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/markdown.ts";

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
