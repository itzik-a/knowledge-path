/* App settings for every device, synced as app data in `.hub/settings.json` (one key a line, so two devices' changes merge).
   Only values that differ from the default are written. Keys: `accent` (src/state/appearance.ts), `sinkChecked`
   (false: ticked tasks stay where they are) and `home` ({ order, hidden }: Home's cards, src/views/Home.tsx). */
import { useSyncExternalStore } from "react";
import { showToast } from "../lib/toast";
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
export const HOME_CARDS: { id: string; name: string }[] = [
  { id: "pinned", name: "Pinned" },
  { id: "habits", name: "Habits" },
  { id: "recipes", name: "Recipes" },
  { id: "journal", name: "Today's journal entry" },
  { id: "now", name: "In progress" },
  { id: "next", name: "Up next" },
  { id: "highlight", name: "From your highlights" },
  { id: "recent", name: "Recently saved" },
];
const DEFAULT_ORDER = HOME_CARDS.map((c) => c.id);
export type HomeLayout = { order: string[]; hidden: string[] };

/** The saved order (unknown ids dropped, cards added since appended in their default place) and the hidden ones. */
export function homeLayout(s: Record<string, unknown>): HomeLayout {
  const h = (s.home && typeof s.home === "object" ? s.home : {}) as { order?: unknown; hidden?: unknown };
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && DEFAULT_ORDER.includes(x)) : []);
  const order = [...new Set(strs(h.order))];
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) {
    // after the card that comes before it by default, else first
    const prev = DEFAULT_ORDER.slice(0, DEFAULT_ORDER.indexOf(id)).reverse().find((p) => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
  }
  return { order, hidden: strs(h.hidden) };
}
export const useHomeLayout = () => homeLayout(useSettings());

/** Write the layout; with a toast, offer Undo. */
function writeHome(l: HomeLayout, toast?: string) {
  const plain = l.order.join() === DEFAULT_ORDER.join();
  const v = plain && !l.hidden.length ? undefined : { ...(plain ? {} : { order: l.order }), ...(l.hidden.length ? { hidden: l.hidden } : {}) };
  if (toast) changeSetting("home", v, toast); else writeSetting("home", v);
}
export function setHomeCardShown(id: string, shown: boolean) {
  const l = homeLayout(readSettings());
  const hidden = shown ? l.hidden.filter((x) => x !== id) : [...new Set([...l.hidden, id])];
  writeHome({ ...l, hidden }, `${HOME_CARDS.find((c) => c.id === id)?.name}: ${shown ? "shown" : "hidden"} on Home`);
}
/** A new order (from dragging in Vault & settings → Home); no toast: dragging again undoes it. */
export function setHomeOrder(order: string[]) {
  const l = homeLayout(readSettings());
  writeHome({ ...l, order: homeLayout({ home: { order } }).order });
}
export function resetHome() { writeHome({ order: DEFAULT_ORDER, hidden: [] }, "Home cards back to the default"); }
