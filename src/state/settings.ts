/* App settings for every device, synced as app data in `.hub/settings.json` (one key a line, so two devices' changes merge).
   Only values that differ from the default are written. Keys: `accent` (src/state/appearance.ts), `sinkChecked`
   (false: ticked tasks stay where they are) and `home` ({ order, hidden }: Home's cards, src/views/Home.tsx). */
import { useSyncExternalStore } from "react";
import { showToast } from "../lib/toast";
import type { Index } from "../../shared/index.ts";
import { readFile, subscribe, writeFile } from "./store";

export const SETTINGS_PATH = ".hub/settings.json";

export function readSettings(): Record<string, unknown> {
  try { const j = JSON.parse(readFile(SETTINGS_PATH) ?? "{}") as unknown; return j && typeof j === "object" && !Array.isArray(j) ? j as Record<string, unknown> : {}; } catch { return {}; }
}

/** Set (or with undefined, remove) one key, keeping the rest. */
export function writeSetting(key: string, value: unknown) {
  const s = readSettings();
  if (value === undefined) delete s[key]; else s[key] = value;
  writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2) + "\n");
}

/** Change one key with an Undo toast that puts its old value back. */
export function changeSetting(key: string, value: unknown, toast: string) {
  const before = readSettings()[key];
  writeSetting(key, value);
  showToast(toast, { label: "Undo", run: () => writeSetting(key, before) });
}

let raw: string | undefined | null = null;
let parsed: Record<string, unknown> = {};
function snapshot() {
  const r = readFile(SETTINGS_PATH);
  if (r !== raw) { raw = r; parsed = readSettings(); }
  return parsed;
}
export const useSettings = () => useSyncExternalStore(subscribe, snapshot);

// ticked tasks sink (Apple Notes style); on unless turned off
export const sinkCheckedOn = (s = readSettings()) => s.sinkChecked !== false;
export const useSinkChecked = () => sinkCheckedOn(useSettings());
export const setSinkChecked = (on: boolean) =>
  changeSetting("sinkChecked", on ? undefined : false, on ? "Ticked items move to the bottom" : "Ticked items stay in place");

// Home's cards
export const HOME_CARDS: HomeCardInfo[] = [
  { id: "pinned", name: "Pinned" },
  { id: "habits", name: "Habits" },
  { id: "recipes", name: "Recipes" },
  { id: "journal", name: "Today's journal entry" },
  { id: "now", name: "In progress" },
  { id: "next", name: "Up next" },
  { id: "cards", name: "Flashcards" },
  { id: "highlight", name: "From your highlights" },
  { id: "recent", name: "Recently saved" },
];
export type HomeCardInfo = { id: string; name: string };
export type HomeLayout = { order: string[]; hidden: string[] };

/** Every card Home can show: the fixed ones, and after Habits one per habit with its own card (`card: true`),
   id `habit:<path>` (renaming the habit puts its card back in that default place). */
export function homeCards(ix: Index): HomeCardInfo[] {
  const own = [...ix.docs.values()].filter((d) => d.kind === "habit" && d.habit?.card && !d.habit.archived)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((d) => ({ id: `habit:${d.path}`, name: `${d.habit!.icon ?? "🔁"} ${d.title}` }));
  const at = HOME_CARDS.findIndex((c) => c.id === "habits") + 1;
  return [...HOME_CARDS.slice(0, at), ...own, ...HOME_CARDS.slice(at)];
}

/** The saved order (unknown ids dropped, cards added since slotted in at their default place) and the hidden ones. */
export function homeLayout(s: Record<string, unknown>, cards: HomeCardInfo[] = HOME_CARDS): HomeLayout {
  const all = cards.map((c) => c.id);
  const h = (s.home && typeof s.home === "object" ? s.home : {}) as { order?: unknown; hidden?: unknown };
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && all.includes(x)) : []);
  const order = [...new Set(strs(h.order))];
  for (const id of all) if (!order.includes(id)) {
    // after the card that comes before it by default, else first
    const prev = all.slice(0, all.indexOf(id)).reverse().find((p) => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
  }
  return { order, hidden: strs(h.hidden) };
}
export const useHomeLayout = (cards: HomeCardInfo[]) => homeLayout(useSettings(), cards);

/** Write the layout (only what differs from the default); with a toast, offer Undo. */
function writeHome(l: HomeLayout, cards: HomeCardInfo[], toast?: string) {
  const plain = l.order.join() === cards.map((c) => c.id).join();
  const v = plain && !l.hidden.length ? undefined : { ...(plain ? {} : { order: l.order }), ...(l.hidden.length ? { hidden: l.hidden } : {}) };
  if (toast) changeSetting("home", v, toast); else writeSetting("home", v);
}
export function setHomeCardShown(id: string, shown: boolean, cards: HomeCardInfo[]) {
  const l = homeLayout(readSettings(), cards);
  const hidden = shown ? l.hidden.filter((x) => x !== id) : [...new Set([...l.hidden, id])];
  writeHome({ ...l, hidden }, cards, `${cards.find((c) => c.id === id)?.name}: ${shown ? "shown" : "hidden"} on Home`);
}
/** A new order (from dragging in Vault & settings → Home); no toast: dragging again undoes it. */
export function setHomeOrder(order: string[], cards: HomeCardInfo[]) {
  const l = homeLayout(readSettings(), cards);
  writeHome({ ...l, order: homeLayout({ home: { order } }, cards).order }, cards);
}
export function resetHome(cards: HomeCardInfo[]) { writeHome({ order: cards.map((c) => c.id), hidden: [] }, cards, "Home cards back to the default"); }
