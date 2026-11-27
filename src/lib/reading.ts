/* How text reads on this device, like a Kindle's Aa menu: the font, its size, the line spacing and alignment of reading text
   (Markdown in .prose and the note editor; the rest of the app keeps its own), and how wide the page gets from 768 px up.
   Per device, since screens differ (localStorage knowledgePath.reading, only what isn't the default), applied as
   <html data-font data-size data-spacing data-align data-width>, which styles.css turns into --read-* and --page-w.
   index.html sets them before the first paint; components/ReadingPanel.tsx is the Aa panel. */
import { useSyncExternalStore } from "react";

export type ReadFont = "system" | "newyork" | "iowan" | "rounded";
export type Spacing = "tight" | "normal" | "relaxed";
export type Align = "start" | "justify";
export type PageWidth = "narrow" | "standard" | "wide" | "full";
export type Reading = { font: ReadFont; size: number; spacing: Spacing; align: Align; width: PageWidth };

export const FONTS: { id: ReadFont; label: string }[] = [
  { id: "system", label: "System" }, { id: "newyork", label: "New York" }, { id: "iowan", label: "Iowan" }, { id: "rounded", label: "Rounded" },
];
/** Text sizes in px for the 16 px default (step 2); styles.css scales reading text by size / 16. */
export const SIZES = [14, 15, 16, 17, 18, 20, 22];
export const SPACINGS: { id: Spacing; label: string }[] = [{ id: "tight", label: "Tight" }, { id: "normal", label: "Normal" }, { id: "relaxed", label: "Relaxed" }];
export const ALIGNS: { id: Align; label: string }[] = [{ id: "start", label: "Ragged" }, { id: "justify", label: "Justified" }];
export const WIDTHS: { id: PageWidth; label: string }[] = [
  { id: "narrow", label: "Narrow" }, { id: "standard", label: "Standard" }, { id: "wide", label: "Wide" }, { id: "full", label: "Full" },
];
export const DEFAULT_READING: Reading = { font: "system", size: 2, spacing: "normal", align: "start", width: "standard" };

const KEY = "knowledgePath.reading";
const subs = new Set<() => void>();
const oneOf = <T extends string>(list: { id: T }[], v: unknown, d: T): T => (list.some((x) => x.id === v) ? (v as T) : d);

function read(): Reading {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { /* nothing or broken: the defaults */ }
  const size = typeof raw.size === "number" && Number.isInteger(raw.size) && raw.size >= 0 && raw.size < SIZES.length ? raw.size : DEFAULT_READING.size;
  return {
    font: oneOf(FONTS, raw.font, DEFAULT_READING.font),
    size,
    spacing: oneOf(SPACINGS, raw.spacing, DEFAULT_READING.spacing),
    align: oneOf(ALIGNS, raw.align, DEFAULT_READING.align),
    width: oneOf(WIDTHS, raw.width, DEFAULT_READING.width),
  };
}

let current = read();
export const getReading = () => current;

export function setReading(patch: Partial<Reading>) {
  const next = { ...current, ...patch };
  const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => DEFAULT_READING[k as keyof Reading] !== v));
  try { if (Object.keys(changed).length) localStorage.setItem(KEY, JSON.stringify(changed)); else localStorage.removeItem(KEY); } catch { /* private mode: this visit only */ }
  apply(next);
}
export const resetReading = () => setReading(DEFAULT_READING);
export const isDefaultReading = (r: Reading) => (Object.keys(DEFAULT_READING) as (keyof Reading)[]).every((k) => r[k] === DEFAULT_READING[k]);

export function useReading(): Reading {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getReading);
}

function apply(r: Reading = read()) {
  current = r;
  const ds = document.documentElement.dataset;
  const set = (k: "font" | "size" | "spacing" | "align" | "width", v: string, d: string) => { if (v === d) delete ds[k]; else ds[k] = v; };
  set("font", r.font, DEFAULT_READING.font);
  set("size", String(SIZES[r.size]), String(SIZES[DEFAULT_READING.size]));
  set("spacing", r.spacing, DEFAULT_READING.spacing);
  set("align", r.align, DEFAULT_READING.align);
  set("width", r.width, DEFAULT_READING.width);
  subs.forEach((f) => f());
}

window.addEventListener("storage", (e) => { if (e.key === KEY) apply(); }); // another tab chose
apply();
