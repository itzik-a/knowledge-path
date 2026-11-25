/* Which sheet is open (one at a time), so any view can open the capture, topic, habit, search, vault, sketch,
   private-notes, cook, shopping or session-timer sheet. */
import { useSyncExternalStore } from "react";
import type { CaptureInit } from "../components/CaptureSheet";

export type SheetReq =
  | { kind: "capture"; init: CaptureInit }
  | { kind: "topic"; id?: string; parent?: string }
  | { kind: "habit"; path?: string; topics?: string[] }
  | { kind: "search" }
  /** vault & settings; `section`: scroll to it ("home") */
  | { kind: "data"; section?: string }
  /** draw: a new sketch for `note`, or change the sketch at `path` */
  | { kind: "sketch"; path?: string; note?: string }
  /** the passphrase for private notes; `then`: a note to make private once it's set */
  | { kind: "private"; then?: string }
  /** cook a recipe, full screen */
  | { kind: "cook"; path: string }
  /** add a recipe's ingredients to the shopping list */
  | { kind: "shop"; path: string }
  /** /ask: a question to Claude about a note */
  | { kind: "ask"; path: string }
  /** start a timed habit (a fast): choose how long */
  | { kind: "timer"; path: string }
  /** the session timer for a habit counted in minutes, full screen */
  | { kind: "sit"; path: string };

let cur: SheetReq | null = null;
const ls = new Set<() => void>();
export function openSheet(r: SheetReq) { cur = r; ls.forEach((l) => l()); }
export function closeSheetReq() { cur = null; ls.forEach((l) => l()); }
export function useSheet() { return useSyncExternalStore((l) => { ls.add(l); return () => { ls.delete(l); }; }, () => cur); }
