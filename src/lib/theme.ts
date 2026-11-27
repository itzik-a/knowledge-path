/* Light, sepia (warm paper, easy on the eyes at night), dark, or the system's light / dark: chosen per device (localStorage
   knowledgePath.theme; nothing set is "system"), applied as <html data-theme="light|sepia|dark">, which styles.css keys the
   sepia and dark tokens on. index.html sets it before the first paint;
   this keeps it right when the choice or the system's appearance changes. The theme-color metas follow the choice
   (and the accent's page colour). */
import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "sepia" | "dark";

const KEY = "knowledgePath.theme";
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const subs = new Set<() => void>();

export function getTheme(): Theme {
  try { const t = localStorage.getItem(KEY); return t === "light" || t === "sepia" || t === "dark" ? t : "system"; } catch { return "system"; }
}

export function setTheme(t: Theme) {
  try { if (t === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private mode: this visit only */ }
  apply(t);
}

export function useTheme(): Theme {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getTheme);
}

let current: Theme = getTheme();
/** The page colour for the theme-color metas: the default, or the accent's own (Graphite: src/state/appearance.ts). */
const DEFAULT_BG = { light: "#F6F5F3", dark: "#0C0B0A" };
const SEPIA_BG = "#F2E8CF";
let bg = DEFAULT_BG;
export function refreshThemeColor(b?: { light: string; dark: string }) { bg = b ?? DEFAULT_BG; apply(current); }

function apply(t: Theme = getTheme()) {
  current = t;
  document.documentElement.dataset.theme = t === "sepia" ? "sepia" : t === "dark" || (t === "system" && dark.matches) ? "dark" : "light";
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][data-for]')) {
    m.content = t === "sepia" ? SEPIA_BG : bg[m.dataset.for === "dark" ? "dark" : "light"];
    const shown = t === "sepia" ? "light" : t; // sepia uses the light meta
    m.media = t === "system" ? `(prefers-color-scheme: ${m.dataset.for})` : m.dataset.for === shown ? "all" : "not all";
  }
  subs.forEach((f) => f());
}

dark.addEventListener("change", () => apply(current));
window.addEventListener("storage", (e) => { if (e.key === KEY) apply(); }); // another tab chose
apply();
