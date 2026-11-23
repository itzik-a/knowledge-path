/* The session timer for habits counted in minutes (meditation, practice, reading): one session at a time, kept
   in localStorage on this device so it survives closing the timer or reloading the app. Optional settling time
   first, a bell at the start, bells along the way, three at the end; the minutes go in the habit's log (added to
   the day's, so two sessions add up). Open-ended sessions count up until ended. The clock here runs whether the
   timer screen is open or not; a Home Screen app can't ring while closed, so the screen is kept on there. */
import { useSyncExternalStore } from "react";
import { todayISO } from "../../shared/vault.ts";
import { playThroughSilentSwitch, ringBell, type BellVolume } from "../lib/bell";
import { unlockAudio } from "../lib/timers";
import { logSession } from "./actions";

export interface Sit {
  path: string;
  title: string;
  /** length, ms; 0 = open-ended (counts up) */
  total: number;
  /** settling time before the first bell, ms */
  settle: number;
  /** a bell every … ms along the way; 0 = none */
  interval: number;
  volume: BellVolume;
  /** when it was started (settling included), ms since 1970 */
  started: number;
  /** when it was paused, while paused */
  paused?: number;
  /** time spent paused, ms */
  pausedMs: number;
  /** the point (ms of sitting) of the last bell rung; -1 before the first */
  lastBell: number;
  /** when it ended */
  doneAt?: number;
  /** minutes logged when it ended (0: nothing logged) */
  logged?: number;
}

const KEY = "knowledgePath.sit";
const ls = new Set<() => void>();
let sit: Sit | null = load();

function load(): Sit | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); return v && typeof v === "object" && typeof v.path === "string" ? v : null; } catch { return null; }
}
function set(next: Sit | null) {
  sit = next;
  try { if (next) localStorage.setItem(KEY, JSON.stringify(next)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
  ls.forEach((l) => l());
  schedule();
}

export const useSit = () => useSyncExternalStore((l) => { ls.add(l); return () => { ls.delete(l); }; }, () => sit);
export const getSit = () => sit;

/** Time since the start, settling included, pauses left out. */
const run = (s: Sit, now: number) => Math.max(0, (s.paused ?? s.doneAt ?? now) - s.started - s.pausedMs);
/** Time sat so far (after settling), ms. */
export const sitElapsed = (s: Sit, now = Date.now()) => Math.max(0, run(s, now) - s.settle);
/** Settling time left, ms. */
export const settleLeft = (s: Sit, now = Date.now()) => Math.max(0, s.settle - run(s, now));
/** Time left, ms (open-ended: 0). */
export const sitLeft = (s: Sit, now = Date.now()) => (s.total ? Math.max(0, s.total - sitElapsed(s, now)) : 0);
/** Whole minutes sat (rounded), what gets logged. */
export const sitMinutes = (s: Sit, now = Date.now()) => Math.round(sitElapsed(s, now) / 60_000);

export function startSit(o: { path: string; title: string; minutes: number; settleSec: number; intervalMin: number; volume: BellVolume }) {
  unlockAudio();
  playThroughSilentSwitch(true);
  set({
    path: o.path, title: o.title, total: o.minutes * 60_000, settle: o.settleSec * 1000, interval: o.intervalMin * 60_000,
    volume: o.volume, started: Date.now(), pausedMs: 0, lastBell: -1,
  });
  check();
}

export function pauseSit() {
  if (sit && sit.paused == null && sit.doneAt == null) set({ ...sit, paused: Date.now() });
}
export function resumeSit() {
  unlockAudio();
  if (sit?.paused != null) set({ ...sit, pausedMs: sit.pausedMs + Date.now() - sit.paused, paused: undefined });
}

/** End now: log the minutes sat (if at least one), or stop without logging. */
export function endSit(log: boolean) {
  if (!sit || sit.doneAt != null) return;
  const now = Date.now();
  const minutes = sitMinutes(sit, now);
  if (!log) { dismissSit(); return; }
  if (minutes >= 1) logSession(sit.path, todayISO(), minutes, sit.title);
  set({ ...sit, doneAt: sit.paused ?? now, logged: minutes >= 1 ? minutes : 0 });
}

/** Clear an ended (or discarded) session. */
export function dismissSit() {
  playThroughSilentSwitch(false);
  set(null);
}

// ── the clock: bells, and the end ─────────────────────────────

/** A bell more than this late (the app was closed or asleep) isn't rung any more. */
const LATE_MS = 5000;

function check() {
  const s = sit;
  if (!s || s.paused != null || s.doneAt != null) return;
  const now = Date.now();
  if (settleLeft(s, now) > 0) return;
  const el = sitElapsed(s, now);
  if (s.total && el >= s.total) {
    if (s.lastBell < s.total && el - s.total < LATE_MS) ringBell("end", s.volume);
    const minutes = Math.round(s.total / 60_000);
    if (minutes >= 1) logSession(s.path, todayISO(), minutes, s.title);
    set({ ...s, lastBell: s.total, doneAt: s.started + s.pausedMs + s.settle + s.total, logged: minutes });
    return;
  }
  // the latest bell that's due: the start (0), or one along the way
  const due = s.interval ? Math.floor(el / s.interval) * s.interval : 0;
  if (due > s.lastBell) {
    if (el - due < LATE_MS) ringBell(due === 0 ? "start" : "interval", s.volume);
    set({ ...s, lastBell: due });
  }
}

let tick = 0;
function schedule() {
  const live = !!sit && sit.paused == null && sit.doneAt == null;
  if (live && !tick) tick = window.setInterval(check, 250);
  if (!live && tick) { clearInterval(tick); tick = 0; }
}
schedule();

// ── choices, remembered on this device ────────────────────────

export interface SitPrefs {
  /** the last length per habit, minutes (0 = open-ended) */
  minutes: Record<string, number>;
  settleSec: number;
  intervalMin: number;
  volume: BellVolume;
  /** show the time while sitting (else only the ring) */
  showTime: boolean;
}
const PREFS = "knowledgePath.sitPrefs";
const DEFAULTS: SitPrefs = { minutes: {}, settleSec: 10, intervalMin: 0, volume: "medium", showTime: true };
let prefs: SitPrefs = loadPrefs();
const pls = new Set<() => void>();
function loadPrefs(): SitPrefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") }; } catch { return DEFAULTS; }
}
export function setSitPrefs(p: Partial<SitPrefs>) {
  prefs = { ...prefs, ...p };
  try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* private mode */ }
  pls.forEach((l) => l());
}
export const useSitPrefs = () => useSyncExternalStore((l) => { pls.add(l); return () => { pls.delete(l); }; }, () => prefs);
