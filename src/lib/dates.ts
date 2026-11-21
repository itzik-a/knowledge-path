/* Dates are local YYYY-MM-DD strings (journal file names, `added:`). */
export { todayISO } from "../../shared/vault.ts";

export const parseISO = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, (m || 1) - 1, dd || 1); };
export const addDays = (d: string, n: number) => { const x = parseISO(d); x.setDate(x.getDate() + n); return iso(x); };
export const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

/** "Saturday, 21 November 2026" */
export const longDate = (d: string) => parseISO(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
/** "Sat 21 Nov" */
export const shortDate = (d: string) => parseISO(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
/** "21 Nov 2026" */
export const medDate = (d: string) => parseISO(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const monthName = (ym: string) => parseISO(ym + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

export function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
