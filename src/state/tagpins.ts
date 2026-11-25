/* Pinned tags: tags aren't files, so their pins are app data, `.hub/tags.json` ({ "pinned": ["dev", "idea"] }, one tag
   a line so two devices' edits merge), synced like the rest of .hub. Shown in the sidebar and first in the Tags tab. */
import { showToast } from "../lib/toast";
import { readFile, useVault, writeFile } from "./store";

export const TAGS_PATH = ".hub/tags.json";

/** The pinned tags in the order they were pinned (lower case, no #). */
export function pinnedTags(): string[] {
  const raw = readFile(TAGS_PATH);
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as { pinned?: unknown };
    return Array.isArray(j.pinned) ? [...new Set(j.pinned.filter((t): t is string => typeof t === "string").map(clean).filter(Boolean))] : [];
  } catch { return []; }
}

const clean = (t: string) => t.trim().replace(/^#/, "").toLowerCase();

/** Re-renders when the vault changes. */
export function usePinnedTags(): string[] {
  useVault();
  return pinnedTags();
}

function save(list: string[]) {
  let rest: Record<string, unknown> = {};
  try { rest = JSON.parse(readFile(TAGS_PATH) ?? "{}") as Record<string, unknown>; } catch { /* broken: start again */ }
  writeFile(TAGS_PATH, JSON.stringify({ ...rest, pinned: list }, null, 2) + "\n");
}

/** Pin a tag (it goes last, so the sidebar keeps its order) or unpin it, with Undo. */
export function setTagPinned(tag: string, on: boolean) {
  const t = clean(tag);
  const before = pinnedTags();
  if (on === before.includes(t)) return;
  save(on ? [...before, t] : before.filter((x) => x !== t));
  showToast(on ? `Pinned #${t}` : `Unpinned #${t}`, { label: "Undo", run: () => save(before) });
}
