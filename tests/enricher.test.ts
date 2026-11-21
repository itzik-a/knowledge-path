import { describe, expect, it } from "vitest";
import { cleanTitle, shortDescription } from "../enricher/extract.ts";
import { explorePath } from "../shared/vault.ts";

describe("enricher helpers", () => {
  it("drops a site name from titles", () => {
    expect(cleanTitle("סטואה – ויקיפדיה", "he.wikipedia.org")).toBe("סטואה");
    expect(cleanTitle("Stoicism - Wikipedia")).toBe("Stoicism");
    expect(cleanTitle("Why we sleep | Aeon Essays", "aeon.co")).toBe("Why we sleep");
    expect(cleanTitle("Rick Astley - Never Gonna Give You Up", "youtube")).toBe("Rick Astley - Never Gonna Give You Up");
    expect(cleanTitle("Marcus Aurelius: Meditations")).toBe("Marcus Aurelius: Meditations");
  });
  it("makes a one-line fallback summary", () => {
    expect(shortDescription("The official video.\n\nFollow https://x.y for more")).toBeUndefined();
    expect(shortDescription("A long first paragraph about Stoic ethics and its reception https://x.y\nsecond line.\n\nmore")).toBe("A long first paragraph about Stoic ethics and its reception second line.");
  });
  it("names explore files safely", () => {
    expect(explorePath("History/Jewish & Israeli History")).toBe(".hub/explore/history-jewish-israeli-history.json");
  });
});
