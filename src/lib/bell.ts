/* A singing-bowl bell, made in the browser: a few slowly fading tones at a bowl's inharmonic ratios, each one a
   pair a little out of tune so it shimmers. No sound files, so it works offline. Plays through the AudioContext
   that a tap unlocked (src/lib/timers.ts). */
import { audioContext } from "./timers";

export type BellVolume = "soft" | "medium" | "loud";
const GAIN: Record<BellVolume, number> = { soft: 0.12, medium: 0.25, loud: 0.45 };

/** [frequency ratio, loudness, seconds to fade out] */
const PARTIALS: [number, number, number][] = [[1, 1, 9], [2.76, 0.45, 6], [5.4, 0.22, 3.5], [8.93, 0.1, 2]];
const BASE = 220;

function strike(volume: number, at: number) {
  const c = audioContext();
  if (!c) return;
  const t0 = c.currentTime + at;
  const out = c.createGain();
  out.gain.value = volume;
  out.connect(c.destination);
  for (const [ratio, amp, fade] of PARTIALS) {
    for (const detune of [-0.6, 0.6]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine";
      o.frequency.value = BASE * ratio + detune * ratio;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp / 2, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + fade);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + fade + 0.05);
    }
  }
}

/** The start (one strike), a bell along the way (one, softer) or the end (three, a few seconds apart). */
export function ringBell(kind: "start" | "interval" | "end", volume: BellVolume) {
  const v = GAIN[volume] * (kind === "interval" ? 0.6 : 1);
  const n = kind === "end" ? 3 : 1;
  for (let i = 0; i < n; i++) strike(v, i * 3.2);
}

/** iPhone: play the bell even with the silent switch on (iOS 17+; elsewhere nothing happens). */
export function playThroughSilentSwitch(on: boolean) {
  const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  try { if (s) s.type = on ? "playback" : "auto"; } catch { /* not supported */ }
}
