import { describe, expect, it } from "vitest";
import { isExternal } from "../src/lib/externalLinks";

const base = "https://itzik-a.github.io/knowledge-path/#doc/Notes/x.md";

describe("isExternal", () => {
  it("is true for web pages on other sites", () => {
    expect(isExternal("https://example.com/a", base)).toBe(true);
    expect(isExternal("http://example.com", base)).toBe(true);
  });
  it("is false for the app's own pages and other schemes", () => {
    expect(isExternal("#home", base)).toBe(false);
    expect(isExternal("https://itzik-a.github.io/knowledge-path/#notes", base)).toBe(false);
    expect(isExternal("mailto:a@b.c", base)).toBe(false);
    expect(isExternal("blob:https://itzik-a.github.io/1", base)).toBe(false);
  });
});
