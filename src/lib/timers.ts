/* Kitchen timers: several at once, kept in localStorage (this device), so they survive closing cook mode or
   reloading the app. When one ends it rings (a few beeps every two seconds, for a minute, or until dismissed)
   and vibrates where the device can. A web app can't ring while it's closed, so cook mode keeps the screen on. */
import { useSyncExternalStore } from "react";

export interface KitchenTimer {
  id: string;
  /** "Simmer · 15 min" */
  label: string;
  /** the recipe it belongs to, to open cook mode from the dock */
  path: string;
  /** total length, ms */
  total: number;
  /** when it ends (ms since 1970) while running */
  ends?: number;
  /** what was left when paused, ms */
  left?: number;
  /** it ended and hasn't been dismissed */
  rang?: boolean;
}

const KEY = "knowledgePath.timers";
let timers: KitchenTimer[] = load();
const ls = new Set<() => void>();

function load(): KitchenTimer[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function set(next: KitchenTimer[]) {
  timers = next;
  try { localStorage.setItem(KEY, JSON.stringify(timers)); } catch { /* private mode */ }
  ls.forEach((l) => l());
  schedule();
}

export const useTimers = () => useSyncExternalStore((l) => { ls.add(l); return () => { ls.delete(l); }; }, () => timers);

/** ms left (0 when it has ended). */
export const leftOf = (t: KitchenTimer, now = Date.now()) => Math.max(0, t.ends != null ? t.ends - now : t.left ?? t.total);

export function fmtLeft(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function startTimer(path: string, label: string, seconds: number): string {
  unlockAudio();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  set([...timers, { id, label, path, total: seconds * 1000, ends: Date.now() + seconds * 1000 }]);
  return id;
}
export function pauseTimer(id: string) {
  set(timers.map((t) => (t.id === id && t.ends != null ? { ...t, left: leftOf(t), ends: undefined } : t)));
}
export function resumeTimer(id: string) {
  unlockAudio();
  set(timers.map((t) => (t.id === id && t.ends == null ? { ...t, ends: Date.now() + (t.left ?? t.total), left: undefined } : t)));
}
/** One more minute (also on a timer that just rang). */
export function addMinute(id: string) {
  set(timers.map((t) => (t.id !== id ? t : t.ends != null ? { ...t, ends: Math.max(t.ends, Date.now()) + 60_000, rang: false, total: t.total + 60_000 } : { ...t, left: (t.left ?? t.total) + 60_000, total: t.total + 60_000 })));
}
export function removeTimer(id: string) { set(timers.filter((t) => t.id !== id)); }

// ── ringing ───────────────────────────────────────────────────

let ctx: AudioContext | null = null;
/** iOS only plays sound from an AudioContext started in a tap: every timer button calls this. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* no audio */ }
}

function beep() {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.28);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.28 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 0.22);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + i * 0.28);
    o.stop(t0 + i * 0.28 + 0.24);
  }
  navigator.vibrate?.([200, 100, 200]);
}

let tick = 0;
let rangAt = new Map<string, number>();
function schedule() {
  const live = timers.some((t) => t.ends != null || t.rang);
  if (live && !tick) tick = window.setInterval(check, 500);
  if (!live && tick) { clearInterval(tick); tick = 0; }
}
function check() {
  const now = Date.now();
  let changed = false;
  const next = timers.map((t) => {
    if (t.ends != null && t.ends <= now && !t.rang) { changed = true; rangAt.set(t.id, now); return { ...t, rang: true }; }
    return t;
  });
  if (changed) set(next);
  // keep ringing every two seconds, for a minute
  for (const t of timers) {
    if (!t.rang) continue;
    const first = rangAt.get(t.id) ?? (rangAt.set(t.id, t.ends ?? now), t.ends ?? now);
    const since = now - first;
    if (since < 60_000 && Math.floor(since / 2000) !== Math.floor((since - 500) / 2000)) beep();
  }
  rangAt = new Map([...rangAt].filter(([id]) => timers.some((t) => t.id === id)));
}
schedule();
