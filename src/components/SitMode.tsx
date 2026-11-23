/* The session timer, full screen (sheet `{ kind: "sit", path }`, from a minutes habit's Timer card or its row):
   choose a length (or open-ended), settling time, bells along the way and the bell's volume; then a quiet screen
   with a ring filling up, pause, End (logs the minutes) and Stop without logging. The screen stays on while it
   runs. Closing it doesn't stop the session: the dock shows it anywhere in the app. State: src/state/sit.ts. */
import { useEffect, useRef, useState } from "react";
import { fmtAmount } from "../../shared/habits.ts";
import { todayISO } from "../../shared/vault.ts";
import { ringBell, type BellVolume } from "../lib/bell";
import { fmtLeft, unlockAudio } from "../lib/timers";
import { useWakeLock } from "../lib/wakelock";
import { dismissSit, endSit, pauseSit, resumeSit, settleLeft, setSitPrefs, sitElapsed, sitLeft, startSit, useSit, useSitPrefs, type Sit } from "../state/sit";
import { useIndex } from "../state/store";
import { useNow } from "./habits";
import { IconCheck, IconClose, IconPause, IconPlay, IconStop } from "./Icons";
import { Seg } from "./ui";

const LENGTHS = [5, 10, 15, 20, 30, 45, 60];

export function SitMode({ path, onClose }: { path: string; onClose: () => void }) {
  const sit = useSit();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const close = () => dlg.current?.close();
  const running = !!sit && sit.doneAt == null;
  const awake = useWakeLock(running);
  const ix = useIndex();
  const title = sit?.title ?? ix.docs.get(path)?.title ?? "Timer";

  return (
    <dialog ref={dlg} className="cook-dlg sit-dlg" aria-label={`${title}: timer`} onClose={onClose}>
      <header className="cook-bar">
        <button type="button" className="icon-btn" onClick={close} aria-label={running ? "Hide the timer (it keeps running)" : "Close"}><IconClose /></button>
        <h2 className="cook-title" dir="auto">{title}</h2>
        <span className="muted small cook-awake" aria-live="polite">{running && awake ? "Screen stays on" : ""}</span>
      </header>
      <div className="sit-body">
        {!sit ? <Setup path={path} title={title} />
          : sit.doneAt != null ? <Done sit={sit} onClose={() => { dismissSit(); close(); }} />
          : <Running sit={sit} onDiscard={() => { endSit(false); close(); }} />}
      </div>
    </dialog>
  );
}

// ── before: the choices ───────────────────────────────────────

function Setup({ path, title }: { path: string; title: string }) {
  const d = useIndex().docs.get(path);
  const prefs = useSitPrefs();
  const first = prefs.minutes[path] ?? d?.habit?.target ?? 10;
  const [minutes, setMinutes] = useState(first);
  const [other, setOther] = useState(first && !LENGTHS.includes(first) ? String(first) : "");
  const custom = Number(other);
  const ok = minutes === 0 || minutes >= 1;

  function start() {
    setSitPrefs({ minutes: { ...prefs.minutes, [path]: minutes } });
    startSit({ path, title, minutes, settleSec: prefs.settleSec, intervalMin: prefs.intervalMin, volume: prefs.volume });
  }

  return (
    <div className="sit-setup">
      <section className="sit-field" aria-labelledby="sit-len">
        <h3 id="sit-len">How long?</h3>
        <div className="sit-lengths" role="group" aria-label="Length">
          {LENGTHS.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={minutes === m} onClick={() => { setMinutes(m); setOther(""); }}>{m} min</button>
          ))}
          <button type="button" className="chip" aria-pressed={minutes === 0} onClick={() => { setMinutes(0); setOther(""); }}>Open-ended</button>
          <label className={`chip sit-other${other && minutes === custom ? " on" : ""}`}>
            <input inputMode="numeric" value={other} placeholder="Other" aria-label="Other length, minutes"
              onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 3); setOther(v); if (+v >= 1) setMinutes(+v); }} />
            {other && <span>min</span>}
          </label>
        </div>
        {minutes === 0 && <p className="muted small">Counts up until you end it.</p>}
      </section>

      <section className="sit-field">
        <h3>Settle first</h3>
        <Seg<number> label="Settling time before the first bell" value={prefs.settleSec} onChange={(v) => setSitPrefs({ settleSec: v })}
          options={[{ id: 0, label: "No" }, { id: 10, label: "10 s" }, { id: 30, label: "30 s" }, { id: 60, label: "1 min" }]} />
      </section>

      <section className="sit-field">
        <h3>Bells along the way</h3>
        <Seg<number> label="Bells along the way" value={prefs.intervalMin} onChange={(v) => setSitPrefs({ intervalMin: v })}
          options={[{ id: 0, label: "None" }, { id: 5, label: "Every 5 min" }, { id: 10, label: "Every 10 min" }]} />
      </section>

      <section className="sit-field">
        <h3>Bell</h3>
        <div className="sit-bell">
          <Seg<BellVolume> label="Bell volume" value={prefs.volume} onChange={(v) => setSitPrefs({ volume: v })}
            options={[{ id: "soft", label: "Soft" }, { id: "medium", label: "Medium" }, { id: "loud", label: "Loud" }]} />
          <button type="button" className="btn ghost sm" onClick={() => { unlockAudio(); ringBell("start", prefs.volume); }}>Hear it</button>
        </div>
      </section>

      <button type="button" className="btn primary sit-start" disabled={!ok} onClick={start}>
        <IconPlay width={18} height={18} /> Start{minutes ? ` · ${minutes} min` : ""}
      </button>
      <p className="muted small">The screen stays on while the timer runs; a web app can't ring once it's closed or the phone is locked. The minutes go in the log when it ends.</p>
    </div>
  );
}

// ── during ────────────────────────────────────────────────────

function Running({ sit, onDiscard }: { sit: Sit; onDiscard: () => void }) {
  const now = useNow(sit.paused == null ? 250 : 0).getTime();
  const prefs = useSitPrefs();
  const settling = settleLeft(sit, now);
  const el = sitElapsed(sit, now);
  const paused = sit.paused != null;
  // the ring: the share sat (open-ended: the current minute)
  const p = settling > 0 ? 1 - settling / sit.settle : sit.total ? Math.min(1, el / sit.total) : (el % 60_000) / 60_000;
  const R = 46, C = 2 * Math.PI * R;
  const big = settling > 0 ? fmtLeft(settling) : sit.total ? fmtLeft(sitLeft(sit, now)) : fmtLeft(el);
  const label = paused ? "Paused" : settling > 0 ? "Settling" : sit.total ? "left" : "so far";

  return (
    <div className="sit-run">
      <button type="button" className={`sit-dial${settling > 0 ? " settling" : ""}`} onClick={() => setSitPrefs({ showTime: !prefs.showTime })}
        aria-label={`${prefs.showTime ? "Hide" : "Show"} the time. ${big} ${label}`}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={R} className="ring-track" />
          {p > 0 && <circle cx="50" cy="50" r={R} className="ring-fill" strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 50 50)" />}
        </svg>
        <span className="sit-time" aria-hidden="true">
          {prefs.showTime || settling > 0 ? <b>{big}</b> : <b className="sit-dot">·</b>}
          <span className="muted small">{label}</span>
        </span>
      </button>
      <p className="muted small sit-meta" aria-live="polite">
        {sit.total ? `${Math.round(sit.total / 60_000)} min` : "Open-ended"}{sit.interval ? ` · a bell every ${sit.interval / 60_000} min` : ""}
      </p>
      <div className="sit-controls">
        <button type="button" className="btn ghost sit-round" onClick={() => (paused ? resumeSit() : pauseSit())} aria-label={paused ? "Resume" : "Pause"}>
          {paused ? <IconPlay width={26} height={26} /> : <IconPause width={26} height={26} />}
        </button>
        <button type="button" className="btn primary sit-end" onClick={() => endSit(true)}><IconStop width={16} height={16} /> End{el >= 60_000 ? " and log" : ""}</button>
      </div>
      <button type="button" className="text-btn muted small" onClick={onDiscard}>Stop without logging</button>
    </div>
  );
}

// ── after ─────────────────────────────────────────────────────

function Done({ sit, onClose }: { sit: Sit; onClose: () => void }) {
  const d = useIndex().docs.get(sit.path);
  const today = d?.log?.find((e) => e.date === todayISO())?.amount;
  const unit = d?.habit?.unit ?? "min";
  return (
    <div className="cook-done sit-done">
      <span className="cook-done-mark" aria-hidden="true"><IconCheck width={34} height={34} /></span>
      <h3>{sit.logged ? `${sit.logged} min logged` : "Under a minute: not logged"}</h3>
      {sit.logged ? today != null && today !== sit.logged && <p className="muted">{fmtAmount(today)} {unit} today in all.</p> : null}
      <button type="button" className="btn primary" autoFocus onClick={onClose}>Close</button>
    </div>
  );
}

/** A session running while the timer screen is closed (anywhere in the app): tap to open it. */
export function SitDock({ onOpen }: { onOpen: (path: string) => void }) {
  const sit = useSit();
  const now = useNow(sit && sit.doneAt == null && sit.paused == null ? 1000 : 0).getTime();
  if (!sit) return null;
  const settling = settleLeft(sit, now);
  const t = sit.doneAt != null ? "Done" : sit.paused != null ? "Paused" : settling > 0 ? fmtLeft(settling) : fmtLeft(sit.total ? sitLeft(sit, now) : sitElapsed(sit, now));
  return (
    <button type="button" className="timer-dock" onClick={() => { unlockAudio(); onOpen(sit.path); }} aria-label={`${sit.title}: ${t}. Open the timer`}>
      <span className="timer-time">{t}</span>
      <span className="small" dir="auto">{sit.title}</span>
    </button>
  );
}
