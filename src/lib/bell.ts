/* A singing-bowl bell, made in the browser: a few slowly fading tones at a bowl's inharmonic ratios, each one a
   pair a little out of tune so it shimmers. No sound files, so it works offline.
   It's rendered once into a WAV and played through an <audio> element, not WebAudio: on an iPhone WebAudio goes
   quiet with the silent switch on, while media elements play anyway. iOS only lets an element play after a tap
   has played it once, so every tap that starts or resumes a session calls primeBell() (a moment of silence);
   the same element then rings the later bells. If it can't play, the bell falls back to WebAudio. */
import { audioContext } from "./timers";

export type BellVolume = "soft" | "medium" | "loud";
export type BellKind = "start" | "interval" | "end";
const GAIN: Record<BellVolume, number> = { soft: 0.12, medium: 0.25, loud: 0.45 };

/** [frequency ratio, loudness, seconds to fade out] */
const PARTIALS: [number, number, number][] = [[1, 1, 9], [2.76, 0.45, 6], [5.4, 0.22, 3.5], [8.93, 0.1, 2]];
const BASE = 220;
const DETUNE = [-0.6, 0.6];
const ATTACK = 0.008;
/** seconds between the end's three strikes */
const GAP = 3.2;

const strikes = (kind: BellKind) => (kind === "end" ? [0, GAP, 2 * GAP] : [0]);
const gainOf = (kind: BellKind, volume: BellVolume) => GAIN[volume] * (kind === "interval" ? 0.6 : 1);

// ── rendering to a WAV ────────────────────────────────────────

const RATE = 22050; // the highest partial is under 2 kHz

/** The bell's samples, -1…1. */
export function bellSamples(kind: BellKind, volume: BellVolume, rate = RATE): Float32Array {
  const at = strikes(kind);
  const len = Math.ceil((at[at.length - 1] + PARTIALS[0][2] + 0.1) * rate);
  const out = new Float32Array(len);
  const v = gainOf(kind, volume);
  for (const t0 of at) {
    const s0 = Math.round(t0 * rate);
    for (const [ratio, amp, fade] of PARTIALS) {
      for (const d of DETUNE) {
        const w = (2 * Math.PI * (BASE * ratio + d * ratio)) / rate;
        const peak = (amp / 2) * v;
        const na = Math.round(ATTACK * rate), nf = Math.round((fade - ATTACK) * rate);
        const k = Math.pow(0.0001 / (amp / 2), 1 / nf); // the exponential fade, per sample
        let g = peak;
        for (let i = 0; i < na + nf && s0 + i < len; i++) {
          const env = i < na ? (peak * i) / na : (g *= k);
          out[s0 + i] += env * Math.sin(w * i);
        }
      }
    }
  }
  return out;
}

function wav(samples: Float32Array, rate = RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

const urls = new Map<string, string>();
function bellURL(kind: BellKind, volume: BellVolume): string {
  const key = `${kind}:${volume}`;
  let u = urls.get(key);
  if (!u) { u = URL.createObjectURL(wav(bellSamples(kind, volume))); urls.set(key, u); }
  return u;
}
let silent = "";
const silence = () => (silent ||= URL.createObjectURL(wav(new Float32Array(RATE / 10))));

// ── playing ───────────────────────────────────────────────────

let el: HTMLAudioElement | null = null;
function element(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!el) { el = new Audio(); el.preload = "auto"; el.setAttribute("playsinline", ""); }
  return el;
}

/** Call in a tap (start, resume, opening the timer): lets the bell ring later without one, on an iPhone too. */
export function primeBell() {
  const a = element();
  if (!a || (!a.paused && !a.ended)) return;
  a.src = silence();
  void a.play().catch(() => {});
}

/** The start (one strike), a bell along the way (one, softer) or the end (three, a few seconds apart). */
export function ringBell(kind: BellKind, volume: BellVolume) {
  const a = element();
  if (!a) { ringWebAudio(kind, volume); return; }
  a.src = bellURL(kind, volume);
  a.currentTime = 0;
  a.play().catch(() => ringWebAudio(kind, volume));
}

// ── the fallback: WebAudio (quiet with the iPhone's silent switch on) ──

function strike(volume: number, at: number) {
  const c = audioContext();
  if (!c) return;
  const t0 = c.currentTime + at;
  const out = c.createGain();
  out.gain.value = volume;
  out.connect(c.destination);
  for (const [ratio, amp, fade] of PARTIALS) {
    for (const d of DETUNE) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine";
      o.frequency.value = BASE * ratio + d * ratio;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp / 2, t0 + ATTACK);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + fade);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + fade + 0.05);
    }
  }
}
function ringWebAudio(kind: BellKind, volume: BellVolume) {
  const v = gainOf(kind, volume);
  for (const t of strikes(kind)) strike(v, t);
}

/** iPhone (iOS 17+): let WebAudio play with the silent switch on too, for the fallback. Elsewhere nothing happens. */
export function playThroughSilentSwitch(on: boolean) {
  const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  try { if (s) s.type = on ? "playback" : "auto"; } catch { /* not supported */ }
}
