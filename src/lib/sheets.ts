/* Which sheet is open (one at a time), so any view can open the capture, topic, search or vault sheet. */
import { useSyncExternalStore } from "react";
import type { CaptureInit } from "../components/CaptureSheet";

export type SheetReq =
  | { kind: "capture"; init: CaptureInit }
  | { kind: "topic"; id?: string; parent?: string }
  | { kind: "search" }
  | { kind: "data" };

let cur: SheetReq | null = null;
const ls = new Set<() => void>();
export function openSheet(r: SheetReq) { cur = r; ls.forEach((l) => l()); }
export function closeSheetReq() { cur = null; ls.forEach((l) => l()); }
export function useSheet() { return useSyncExternalStore((l) => { ls.add(l); return () => { ls.delete(l); }; }, () => cur); }
