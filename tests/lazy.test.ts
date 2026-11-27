import { describe, expect, it } from "vitest";
import { canReloadForUpdate } from "../src/lib/lazy";

describe("reloading onto a new version", () => {
  it("reloads once, and not again within a minute (a file that's really broken mustn't loop)", () => {
    expect(canReloadForUpdate(1_000_000, 0)).toBe(true);
    expect(canReloadForUpdate(1_000_000, 1_000_000 - 30_000)).toBe(false);
    expect(canReloadForUpdate(1_000_000, 1_000_000 - 61_000)).toBe(true);
  });
});
