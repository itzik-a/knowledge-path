/* The accent colour: one choice for every device, synced as app data in `.hub/settings.json` ({ "accent": "blue" }; none or
   "plum" is the default). Applied as <html data-accent="…">, which styles.css keys each accent's tokens on (light and dark).
   A copy is kept in localStorage (knowledgePath.accent) only so index.html can set it before the first paint; the vault's
   file is the truth and wins whenever it changes (another device chose). Light / Dark stays per device (src/lib/theme.ts). */
import { useSyncExternalStore } from "react";
import { refreshThemeColor } from "../lib/theme";
import { showToast } from "../lib/toast";
import { readFile, subscribe } from "./store";
import { SETTINGS_PATH, readSettings, writeSetting } from "./settings";
const KEY = "knowledgePath.accent";

export type Accent = "plum" | "blue" | "teal" | "green" | "amber" | "indigo" | "crimson" | "graphite";

/** The swatches (the same values as styles.css): each mode's accent and the colour that reads on it; Crimson's and Graphite's background too, and the swatch's other half (Graphite: its sidebar). */
export const ACCENTS: { id: Accent; name: string; light: string; dark: string; onDark: string; bg?: { light: string; dark: string }; split?: { light: string; dark: string } }[] = [
  { id: "plum", name: "Plum", light: "#9C2F5A", dark: "#F08DB4", onDark: "#3A0A1E" },
  { id: "blue", name: "Blue", light: "#1F5FBF", dark: "#8DB8F5", onDark: "#0A1A33" },
  { id: "teal", name: "Teal", light: "#0F766E", dark: "#6FD6CC", onDark: "#052522" },
  { id: "green", name: "Green", light: "#2F7A2F", dark: "#8BD68B", onDark: "#0A240D" },
  { id: "amber", name: "Amber", light: "#9A5200", dark: "#F2B76A", onDark: "#2E1A00" },
  { id: "indigo", name: "Indigo", light: "#4B3FB8", dark: "#A99EF5", onDark: "#15103A" },
  { id: "crimson", name: "Crimson (red on cool grey)", light: "#C8393B", dark: "#F0716F", onDark: "#2A0C0C", bg: { light: "#F7F7F8", dark: "#1C1D20" } },
  { id: "graphite", name: "Graphite (red, dark sidebar)", light: "#DD4C4F", dark: "#DD4C4F", onDark: "#FFFFFF", bg: { light: "#F3F5F7", dark: "#1F2022" }, split: { light: "#2E3235", dark: "#292A2C" } },
];

const isAccent = (v: unknown): v is Accent => ACCENTS.some((a) => a.id === v);

let current: Accent = (() => { try { const v = localStorage.getItem(KEY); return isAccent(v) ? v : "plum"; } catch { return "plum"; } })();
const subs = new Set<() => void>();

export const getAccent = () => current;
export function useAccent(): Accent {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getAccent);
}

function apply(a: Accent) {
  current = a;
  if (a === "plum") delete document.documentElement.dataset.accent; else document.documentElement.dataset.accent = a;
  try { if (a === "plum") localStorage.removeItem(KEY); else localStorage.setItem(KEY, a); } catch { /* private mode */ }
  refreshThemeColor(ACCENTS.find((x) => x.id === a)?.bg);
  setIcons(a);
  subs.forEach((f) => f());
}

/** The tab icon and the manifest (its theme colour) follow the accent (files from scripts/make-icons.ts). The installed app's
   icon is always Crimson's (it was Graphite's until Graphite got Bear's grey), whatever the accent: index.html's apple-touch-icon and every manifest's icons. */
export const iconOf = (a: Accent) => `./icons/icon-${a}.svg`;
/** The sidebar header's logo: Graphite's is Bear's greys (scripts/make-icons.ts LOGOS); the others are their tab icon. */
export const logoOf = (a: Accent) => (a === "graphite" ? "./icons/logo-graphite.svg" : iconOf(a));
function setIcons(a: Accent) {
  const set = (sel: string, href: string) => { const l = document.querySelector<HTMLLinkElement>(sel); if (l && l.getAttribute("href") !== href) l.setAttribute("href", href); };
  set('link[rel="icon"]', iconOf(a));
  set('link[rel="manifest"]', `./manifest-${a}.webmanifest`);
}

/** Follow the vault's file (called on every change; cheap when nothing changed). Before the vault has loaded, keep the copy. */
let seen: string | undefined;
function follow() {
  const raw = readFile(SETTINGS_PATH);
  if (raw === seen) return;
  seen = raw;
  const v = readSettings().accent;
  apply(isAccent(v) ? v : "plum");
}

/** Choose an accent for every device, with Undo. */
export function setAccent(a: Accent) {
  const before = current;
  if (a === before) return;
  const write = (x: Accent) => writeSetting("accent", x === "plum" ? undefined : x);
  write(a);
  showToast(`Accent: ${ACCENTS.find((x) => x.id === a)!.name.split(" (")[0]}`, { label: "Undo", run: () => write(before) });
}

/** Start following the vault once it has loaded (main.tsx). */
export function startAppearance() {
  follow();
  subscribe(follow);
}
