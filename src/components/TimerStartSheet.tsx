/* Starting a timed habit (a fast): how long (chips, other, or open-ended) and when it began (now, or earlier),
   then Start. Sheet `{ kind: "timer", path }`, from the habit's Start buttons. The last length chosen is kept per
   habit on this device (localStorage knowledgePath.timerPrefs); the first time it's the habit's goal. */
import { useRef, useState } from "react";
import { fmtAmount, fmtHours, parseHours, parseStamp, stampOf, stampTime } from "../../shared/habits.ts";
import { startTimer } from "../state/actions";
import { useIndex } from "../state/store";
import { whenText } from "./habits";
import { IconPlay } from "./Icons";
import { Seg, Sheet, closeSheet } from "./ui";

const LENGTHS = [12, 14, 16, 18, 20, 24, 36, 48];
const KEY = "knowledgePath.timerPrefs";

const readPrefs = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>; } catch { return {}; } };
function remember(path: string, hours: number) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), [path]: hours })); } catch { /* private mode */ }
}

export function TimerStartSheet({ path, onClose }: { path: string; onClose: () => void }) {
  const d = useIndex().docs.get(path);
  const first = readPrefs()[path] ?? d?.habit?.target ?? 16;
  const [hours, setHours] = useState(first);
  const [other, setOther] = useState(first && !LENGTHS.includes(first) ? fmtAmount(first) : "");
  const [when, setWhen] = useState<"now" | "earlier">("now");
  const [at, setAt] = useState(() => stampOf(new Date(Date.now() - 36e5)));
  const form = useRef<HTMLFormElement>(null);
  if (!d?.habit) return null;

  const max = stampOf(new Date());
  const startAt = when === "now" ? new Date() : parseStamp(at) && parseStamp(at)! <= max ? stampTime(parseStamp(at)!) : undefined;
  const ok = !!startAt && hours >= 0;
  const endsAt = startAt && hours > 0 ? new Date(startAt.getTime() + hours * 36e5) : undefined;

  function start() {
    if (!ok) return;
    remember(path, hours);
    startTimer(path, hours, startAt);
    closeSheet(form.current);
  }

  return (
    <Sheet title={`Start: ${d.title}`} onClose={onClose}>
      <form ref={form} className="form-grid" onSubmit={(e) => { e.preventDefault(); start(); }}>
        <div className="field">
          <span className="field-label">How long?</span>
          <div className="sit-lengths" role="group" aria-label="Length">
            {LENGTHS.map((h) => (
              <button key={h} type="button" className="chip" aria-pressed={hours === h} onClick={() => { setHours(h); setOther(""); }}>{h} h</button>
            ))}
            <button type="button" className="chip" aria-pressed={hours === 0} onClick={() => { setHours(0); setOther(""); }}>Open-ended</button>
            <label className={`chip sit-other${other && hours === parseHours(other) ? " on" : ""}`}>
              <input inputMode="decimal" value={other} placeholder="Other" aria-label="Other length, hours (16:30 or 16.5)"
                onChange={(e) => { const v = e.target.value.replace(/[^\d.,:]/g, "").slice(0, 5); setOther(v); const n = parseHours(v); if (n) setHours(n); }} />
              {other && <span>h</span>}
            </label>
          </div>
          {hours === 0 && <p className="muted small">Counts up until you end it.</p>}
        </div>
        <div className="field">
          <span className="field-label">Started</span>
          <Seg<"now" | "earlier"> label="Started" value={when} onChange={setWhen} options={[{ id: "now", label: "Now" }, { id: "earlier", label: "Earlier" }]} />
          {when === "earlier" && (
            <input className="text-input" type="datetime-local" max={max} value={at} onChange={(e) => setAt(e.target.value)} aria-label="When it started" required />
          )}
        </div>
        <p className="muted small" aria-live="polite">
          {endsAt ? `${fmtHours(hours)}: done ${whenText(endsAt)}.` : hours === 0 ? "No end time: end it when you're done." : ""}
          {" "}The hours go in the log on the day you end it.
        </p>
        <button className="btn primary" type="submit" disabled={!ok}><IconPlay width={16} height={16} /> Start{hours > 0 ? ` · ${fmtHours(hours)}` : ""}</button>
      </form>
    </Sheet>
  );
}
