/* Habit pieces: the check button (a start / stop button for a timed habit), the amount form, the habit rows
   (Home and #habits), a timed habit's timer card, the last-7-days strip, the calendar heatmap and the log list. */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Doc } from "../../shared/index.ts";
import { dayNum, dayStr, fmtAmount, fmtHours, goalLabel, habitStats, hoursSince, parseHours, parseStamp, shiftDay, stampOf, stampTime, weekOf, type HabitStats, type LogEntry } from "../../shared/habits.ts";
import { todayISO } from "../../shared/vault.ts";
import { longDate, medDate, parseISO, shortDate } from "../lib/dates";
import { docHref } from "../lib/route";
import { discardTimer, endTimer, logHabit, setTimerStart, startTimer, unlogHabit } from "../state/actions";
import { IconCheck, IconClose, IconEdit, IconPlay, IconStop, IconTrash } from "./Icons";

export const habitIcon = (d: Doc) => d.habit?.icon ?? "🔁";
export const amountText = (d: Doc, n?: number) => (n == null ? "" : d.habit?.timer ? fmtHours(n) : `${fmtAmount(n)}${d.habit?.unit && d.habit.unit !== "times" ? ` ${d.habit.unit}` : n === 1 ? " time" : " times"}`);
const dayLabel = (date: string, today: string) => (date === today ? "today" : date === shiftDay(today, -1) ? "yesterday" : shortDate(date));

/** The amount to start the form with: the usual amount, else the last one logged. */
const startAmount = (d: Doc) => d.habit?.target ?? d.log?.find((e) => e.amount != null)?.amount;

/** Hours as "16:20" (a timed habit's amounts in forms and the week strip). */
const hm = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
/** An amount as it goes in a form. */
const amountInput = (d: Doc, n?: number) => (n == null ? "" : d.habit?.timer ? hm(n) : fmtAmount(n));
/** What was typed as an amount: hours ("16:30", "16.5") for a timed habit. */
const readAmount = (d: Doc, v: string) => {
  if (d.habit?.timer) return parseHours(v);
  const n = Number(v.replace(",", "."));
  return v.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
};
const amountChars = (v: string) => v.replace(/[^\d.,]/g, "");

/** Hours and minutes as two number fields (the iPhone's number pad has no colon); the value is "16:20". */
function HmInput({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  const [h = "", m = ""] = value.split(":");
  const set = (hh: string, mm: string) => onChange(hh || mm ? `${hh || "0"}:${mm}` : "");
  return (
    <span className="hm-input" role="group" aria-label={label}>
      <input className="text-input" inputMode="numeric" autoFocus={autoFocus} onFocus={(e) => e.target.select()} value={h} placeholder="16"
        onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 3), m)} aria-label="Hours" />
      <span className="muted">h</span>
      <input className="text-input" inputMode="numeric" onFocus={(e) => e.target.select()} value={m} placeholder="00"
        onChange={(e) => { const x = e.target.value.replace(/\D/g, "").slice(0, 2); set(h, x && +x > 59 ? "59" : x); }} aria-label="Minutes" />
      <span className="muted">m</span>
    </span>
  );
}

/** The time now, again every `ms` (not at all with 0). */
export function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!ms) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), ms);
    const wake = () => { if (document.visibilityState === "visible") setNow(new Date()); };
    document.addEventListener("visibilitychange", wake);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", wake); };
  }, [ms]);
  return now;
}

/** "20:00", "yesterday 20:00", "tomorrow 12:00", "Fri 20:00" */
export function whenText(t: Date, now = new Date()): string {
  const time = t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = stampOf(t).slice(0, 10), today = stampOf(now).slice(0, 10);
  if (day === today) return time;
  if (day === shiftDay(today, -1)) return `yesterday ${time}`;
  if (day === shiftDay(today, 1)) return `tomorrow ${time}`;
  return `${shortDate(day)} ${time}`;
}

export function statsOf(d: Doc, today = todayISO()): HabitStats {
  return habitStats(d.habit!.goal, d.log ?? [], today);
}

/** "20 min today · 5-day streak", "2 of 3 this week · 4-week streak" */
export function habitMeta(d: Doc, s: HabitStats, today = todayISO(), now = new Date()): string {
  const g = d.habit!.goal;
  const parts: string[] = [];
  if (d.habit!.started) {
    const el = hoursSince(d.habit!.started, now), target = d.habit!.target;
    parts.push(target && el >= target ? `${fmtHours(el)} · goal reached` : `${fmtHours(el)}${target ? ` of ${fmtAmount(target)} h` : " so far"}`);
    if (s.current) parts.push(`${s.current}-${s.unit} streak`);
    return parts.join(" · ");
  }
  const t = d.log?.find((e) => e.date === today);
  if (t?.amount != null) parts.push(`${amountText(d, t.amount)} today`);
  if (g.per === "week") parts.push(`${s.thisWeek} of ${g.times} this week`);
  if (s.current) parts.push(`${s.current}-${s.unit} streak`);
  else if (g.per === "day" && !t) parts.push(goalLabel(g));
  return parts.join(" · ");
}

/** Tap to log a day (asking for the amount when the habit has one); tap again to take it off, with Undo. */
export function toggleDay(d: Doc, date: string, ask: () => void, today = todayISO()) {
  if (d.log?.some((e) => e.date === date)) unlogHabit(d.path, date, `${d.title}, ${dayLabel(date, today)}`);
  else if (d.habit?.unit) ask();
  else logHabit(d.path, date);
}

export function HabitCheck({ d, date, onAsk, size = "md" }: { d: Doc; date: string; onAsk: () => void; size?: "md" | "sm" }) {
  const done = !!d.log?.some((e) => e.date === date);
  const today = todayISO();
  return (
    <button type="button" className={`habit-check${done ? " on" : ""}${size === "sm" ? " sm" : ""}`} aria-pressed={done}
      aria-label={done ? `${d.title}: logged ${dayLabel(date, today)}. Tap to remove` : `Log ${d.title} ${dayLabel(date, today)}`}
      onClick={() => toggleDay(d, date, onAsk, today)}>
      <IconCheck width={size === "sm" ? 16 : 20} height={size === "sm" ? 16 : 20} />
    </button>
  );
}

/** A timed habit's button: start the timer, or end it (a ring around it fills toward the goal). */
export function TimerButton({ d, now }: { d: Doc; now: Date }) {
  const h = d.habit!;
  if (!h.started) {
    return (
      <button type="button" className="habit-check timer" aria-label={`Start ${d.title}`} onClick={() => startTimer(d.path)}>
        <IconPlay width={18} height={18} />
      </button>
    );
  }
  const el = hoursSince(h.started, now);
  const p = h.target ? Math.min(1, el / h.target) : 0;
  const C = 2 * Math.PI * 20;
  return (
    <button type="button" className={`habit-check timer running${p >= 1 ? " met" : ""}`} aria-label={`End ${d.title} (${fmtHours(el)} so far)`} onClick={() => endTimer(d.path, d.title)}>
      <svg className="timer-ring" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="20" className="ring-track" />
        {p > 0 && <circle cx="22" cy="22" r="20" className="ring-fill" strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 22 22)" />}
      </svg>
      <IconStop width={16} height={16} />
    </button>
  );
}

/** A timed habit's timer on its page: how long so far, toward the goal, when it started (and changing that), End and Discard. */
export function TimerCard({ d }: { d: Doc }) {
  const h = d.habit!;
  const now = useNow(h.started ? 5000 : 0);
  const [editing, setEditing] = useState(false);
  if (!h.started) {
    const last = d.log?.find((e) => e.amount != null);
    return (
      <section className="card timer-card">
        <div className="timer-idle">
          <div className="grow">
            <h2>Timer</h2>
            <p className="muted small">{last ? `Last: ${fmtHours(last.amount!)}, ${shortDate(last.date)}` : "Start it when you begin and end it when you're done; the hours go in the log."}</p>
          </div>
          <button type="button" className="btn primary" onClick={() => startTimer(d.path)}><IconPlay width={16} height={16} /> Start</button>
        </div>
        <p className="muted small">Started earlier? Start it, then change the start time.</p>
      </section>
    );
  }
  const start = stampTime(h.started);
  const el = hoursSince(h.started, now);
  const target = h.target;
  const met = !!target && el >= target;
  const goalAt = target ? new Date(start.getTime() + target * 36e5) : undefined;
  return (
    <section className="card timer-card running">
      <span className="eyebrow">Running since {whenText(start, now)}</span>
      <div className="timer-big" aria-live="off">{fmtHours(el)}</div>
      {target && (
        <>
          <div className="timer-bar" role="progressbar" aria-label="Toward the goal" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(el, target)} aria-valuetext={`${fmtHours(el)} of ${fmtAmount(target)} h`}>
            <span style={{ width: `${Math.min(100, (el / target) * 100)}%` }} />
          </div>
          <p className="muted small">{met ? `Goal of ${fmtAmount(target)} h reached at ${whenText(goalAt!, now)}` : `Goal of ${fmtAmount(target)} h at ${whenText(goalAt!, now)} · ${fmtHours(target - el)} to go`}</p>
        </>
      )}
      {editing && <StartForm d={d} started={h.started} onDone={() => setEditing(false)} />}
      <div className="btn-row">
        <button type="button" className="btn primary" onClick={() => endTimer(d.path, d.title)}><IconStop width={16} height={16} /> End</button>
        {!editing && <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Change start</button>}
        <button type="button" className="btn ghost sm" onClick={() => discardTimer(d.path, d.title)}>Discard</button>
      </div>
    </section>
  );
}

function StartForm({ d, started, onDone }: { d: Doc; started: string; onDone: () => void }) {
  const [v, setV] = useState(started);
  const max = stampOf(new Date());
  const ok = !!parseStamp(v) && parseStamp(v)! <= max;
  function save(e: FormEvent) {
    e.preventDefault();
    const s = parseStamp(v);
    if (!s) return;
    setTimerStart(d.path, stampTime(s));
    onDone();
  }
  return (
    <form className="form-grid sub-form" onSubmit={save}>
      <label className="field"><span className="field-label">Started</span>
        <input className="text-input" type="datetime-local" max={max} value={v} onChange={(e) => setV(e.target.value)} required />
      </label>
      <div className="btn-row">
        <button type="submit" className="btn primary sm" disabled={!ok}>Save</button>
        <button type="button" className="btn ghost sm" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

/** Log a day with an amount (empty is fine: the day is logged without one). */
export function AmountForm({ d, date, initial, onDone }: { d: Doc; date: string; initial?: number; onDone: () => void }) {
  const [v, setV] = useState(() => amountInput(d, initial ?? startAmount(d)));
  const unit = d.habit?.unit && d.habit.unit !== "times" ? d.habit.unit : "times";
  function save(e: FormEvent) {
    e.preventDefault();
    logHabit(d.path, date, readAmount(d, v));
    onDone();
  }
  return (
    <form className="amount-form" onSubmit={save}>
      {d.habit?.timer ? (
        <span className="amount-input"><HmInput value={v} onChange={setV} autoFocus label={`How long, ${dayLabel(date, todayISO())}`} /></span>
      ) : (
        <label className="amount-input">
          <input className="text-input" inputMode="decimal" autoFocus onFocus={(e) => e.target.select()} value={v} onChange={(e) => setV(amountChars(e.target.value))}
            aria-label={`How much (${unit}), ${dayLabel(date, todayISO())}`} placeholder="0" />
          <span className="muted" dir="auto">{unit}</span>
        </label>
      )}
      <button type="submit" className="btn primary sm">Log</button>
      <button type="button" className="icon-btn subtle" onClick={onDone} aria-label="Cancel"><IconClose width={18} height={18} /></button>
    </form>
  );
}

/** A habit in a list: icon, name, streak, today's check; on #habits also the last 7 days. */
export function HabitRow({ d, strip }: { d: Doc; strip?: boolean }) {
  const today = todayISO();
  const [asking, setAsking] = useState(false);
  const now = useNow(d.habit?.started ? 30000 : 0);
  const s = statsOf(d, today);
  return (
    <li className="habit-item">
      <div className="habit-row">
        <a className="habit-main" href={docHref(d.path)}>
          <span className="thumb emoji" aria-hidden="true">{habitIcon(d)}</span>
          <span className="item-main">
            <span className="item-title" dir="auto">{d.title}</span>
            <span className="item-meta">{habitMeta(d, s, today, now)}</span>
            {strip && <MiniWeek d={d} today={today} />}
          </span>
        </a>
        {d.habit?.timer ? <TimerButton d={d} now={now} /> : <HabitCheck d={d} date={today} onAsk={() => setAsking(true)} />}
      </div>
      {asking && <AmountForm d={d} date={today} onDone={() => setAsking(false)} />}
    </li>
  );
}

/** The last 7 days as small dots (not interactive; the habit's page has the big ones). */
function MiniWeek({ d, today }: { d: Doc; today: string }) {
  const days = new Set(d.log?.map((e) => e.date));
  const list = Array.from({ length: 7 }, (_, i) => shiftDay(today, i - 6));
  const n = list.filter((x) => days.has(x)).length;
  return (
    <span className="mini-week" role="img" aria-label={`${n} of the last 7 days logged`}>
      {list.map((x) => <span key={x} className={days.has(x) ? "on" : undefined} title={`${shortDate(x)}${days.has(x) ? ": logged" : ""}`} />)}
    </span>
  );
}

/** The last 7 days, each one a button: log it or take it off. */
export function WeekStrip({ d }: { d: Doc }) {
  const today = todayISO();
  const [asking, setAsking] = useState<string | null>(null);
  const byDate = new Map(d.log?.map((e) => [e.date, e] as [string, LogEntry]));
  const list = Array.from({ length: 7 }, (_, i) => shiftDay(today, i - 6));
  return (
    <div className="week-strip-wrap">
      <div className="week-strip">
        {list.map((x) => {
          const e = byDate.get(x);
          const dt = parseISO(x);
          return (
            <button key={x} type="button" className={`wday${e ? " on" : ""}${x === today ? " today" : ""}`} aria-pressed={!!e}
              aria-label={`${longDate(x)}: ${e ? `logged${e.amount != null ? `, ${amountText(d, e.amount)}` : ""}` : "not logged"}`}
              onClick={() => toggleDay(d, x, () => setAsking(x), today)}>
              <span className="wday-name">{dt.toLocaleDateString("en-GB", { weekday: "narrow" })}</span>
              <span className="wday-dot">{e ? <IconCheck width={16} height={16} /> : dt.getDate()}</span>
              {d.habit?.unit && <span className="wday-amt">{e?.amount != null ? (d.habit.timer ? hm(e.amount) : fmtAmount(e.amount)) : ""}</span>}
            </button>
          );
        })}
      </div>
      {asking && <AmountForm key={asking} d={d} date={asking} onDone={() => setAsking(null)} />}
    </div>
  );
}

// ── the calendar heatmap ──────────────────────────────────────
const PITCH = 17, CELL = 14, LEFT = 18, TOP = 14;

/** Weeks as columns (Monday on top), one cell a day. Logged days in the accent; with amounts, three steps of it
    (more is stronger: darker on light, brighter on dark). Hover or tap a day to see it; the line below logs it or takes it off. */
export function Heatmap({ d, weeks }: { d: Doc; weeks: number }) {
  const today = todayISO();
  const t = dayNum(today);
  const start = dayNum(weekOf(today)) - (weeks - 1) * 7;
  const byDate = useMemo(() => new Map(d.log?.map((e) => [e.date, e] as [string, LogEntry])), [d.log]);
  const amounts = !!d.habit?.unit;
  const max = useMemo(() => Math.max(0, ...(d.log ?? []).filter((e) => dayNum(e.date) >= start).map((e) => e.amount ?? 0)), [d.log, start]);
  const level = (e: LogEntry) => (!amounts || !max ? 3 : e.amount == null ? 2 : e.amount / max <= 1 / 3 ? 1 : e.amount / max <= 2 / 3 ? 2 : 3);
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const focus = hover ?? sel;

  const cells: { date: string; x: number; y: number; e?: LogEntry }[] = [];
  const months: { x: number; label: string }[] = [];
  for (let c = 0; c < weeks; c++) {
    const mon = dayStr(start + c * 7);
    const prev = c > 0 ? dayStr(start + (c - 1) * 7) : undefined;
    if (!prev || mon.slice(5, 7) !== prev.slice(5, 7)) {
      const x = LEFT + c * PITCH;
      if (!months.length || x - months[months.length - 1].x >= PITCH * 3) months.push({ x, label: parseISO(mon).toLocaleDateString("en-GB", { month: "short" }) });
    }
    for (let r = 0; r < 7; r++) {
      const n = start + c * 7 + r;
      if (n > t) break;
      const date = dayStr(n);
      cells.push({ date, x: LEFT + c * PITCH, y: TOP + r * PITCH, e: byDate.get(date) });
    }
  }
  const logged = cells.filter((c) => c.e).length;
  const W = LEFT + weeks * PITCH, H = TOP + 7 * PITCH;
  const fe = focus ? byDate.get(focus) : undefined;

  return (
    <div className="heatmap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W * 1.25 }} role="img" aria-label={`${d.title}: logged ${logged} of the last ${cells.length} days`}
        onPointerLeave={() => setHover(null)}>
        {months.map((m) => <text key={m.x} x={m.x} y={9} className="hm-label">{m.label}</text>)}
        {["M", "W", "F"].map((l, i) => <text key={l} x={0} y={TOP + (i * 2) * PITCH + CELL - 3} className="hm-label">{l}</text>)}
        {cells.map((c) => (
          <g key={c.date} onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(c.date); }} onClick={() => { setSel(c.date === sel ? null : c.date); setAsking(null); }}>
            <rect x={c.x - 1.5} y={c.y - 1.5} width={PITCH} height={PITCH} fill="transparent" />
            <rect x={c.x} y={c.y} width={CELL} height={CELL} rx={3} className={c.e ? `hm-on hm-${level(c.e)}` : "hm-off"} />
            {(c.date === today || c.date === focus) && <rect x={c.x - 1} y={c.y - 1} width={CELL + 2} height={CELL + 2} rx={4} className={c.date === focus ? "hm-focus" : "hm-today"} />}
          </g>
        ))}
      </svg>
      <div className="hm-foot">
        {focus ? (
          <div className="hm-detail" aria-live="polite">
            <span><b>{shortDate(focus)}</b> <span className="muted">{fe ? `logged${fe.amount != null ? `, ${amountText(d, fe.amount)}` : ""}` : "not logged"}</span></span>
            {sel === focus && !asking && (
              <button type="button" className="btn ghost sm" onClick={() => toggleDay(d, focus, () => setAsking(focus), today)}>{fe ? "Remove" : "Log this day"}</button>
            )}
          </div>
        ) : (
          <span className="muted small">Tap a day to see it or log it.</span>
        )}
        <span className="hm-legend" aria-hidden="true">
          <span className="hm-key hm-off" />{amounts ? <><span className="muted small">Less</span><span className="hm-key hm-on hm-1" /><span className="hm-key hm-on hm-2" /><span className="hm-key hm-on hm-3" /><span className="muted small">More</span></> : <><span className="muted small">Not logged</span><span className="hm-key hm-on hm-3" /><span className="muted small">Logged</span></>}
        </span>
      </div>
      {asking && <AmountForm key={asking} d={d} date={asking} onDone={() => setAsking(null)} />}
    </div>
  );
}

// ── the log list ──────────────────────────────────────────────
export function LogList({ d }: { d: Doc }) {
  const today = todayISO();
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const log = d.log ?? [];
  const shown = all ? log : log.slice(0, 14);
  const year = today.slice(0, 4);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Log{log.length ? <span className="muted"> · {log.length}</span> : null}</h2>
        {!adding && <button type="button" className="btn ghost sm" onClick={() => setAdding(true)}>Log a day</button>}
      </div>
      {adding && <LogDayForm d={d} onDone={() => setAdding(false)} />}
      {!log.length && !adding && <p className="muted small">Nothing logged yet. Each day you log is a line in this habit's note, so it reads the same in Obsidian.</p>}
      <ul className="log-list">
        {shown.map((e) => (
          <li key={e.date}>
            {edit === e.date ? (
              <AmountForm d={d} date={e.date} initial={e.amount} onDone={() => setEdit(null)} />
            ) : (
              <>
                <span className="grow"><b>{e.date.startsWith(year) ? shortDate(e.date) : medDate(e.date)}</b>{e.date === today && <span className="muted"> · today</span>}</span>
                {e.amount != null && <span className="log-amt">{amountText(d, e.amount)}</span>}
                {d.habit?.unit && <button type="button" className="icon-btn subtle" aria-label={`Change the amount for ${shortDate(e.date)}`} onClick={() => setEdit(e.date)}><IconEdit width={18} height={18} /></button>}
                <button type="button" className="icon-btn subtle" aria-label={`Remove ${shortDate(e.date)}`} onClick={() => unlogHabit(d.path, e.date, `${d.title}, ${dayLabel(e.date, today)}`)}><IconTrash width={18} height={18} /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      {log.length > shown.length && <button type="button" className="btn ghost sm" onClick={() => setAll(true)}>Show all {log.length}</button>}
    </section>
  );
}

function LogDayForm({ d, onDone }: { d: Doc; onDone: () => void }) {
  const today = todayISO();
  const [date, setDate] = useState(shiftDay(today, -1));
  const [v, setV] = useState(() => amountInput(d, startAmount(d)));
  const unit = d.habit?.unit && d.habit.unit !== "times" ? d.habit.unit : "times";
  const had = d.log?.find((e) => e.date === date);
  function save(e: FormEvent) {
    e.preventDefault();
    if (!date || date > today) return;
    logHabit(d.path, date, d.habit?.unit ? readAmount(d, v) : undefined);
    onDone();
  }
  return (
    <form className="form-grid sub-form" onSubmit={save}>
      <div className={d.habit?.timer ? "form-grid" : "form-row"}>
        <label className="field"><span className="field-label">Day</span>
          <input className="text-input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        {d.habit?.timer ? (
          <div className="field"><span className="field-label">How long</span><HmInput value={v} onChange={setV} label="How long" /></div>
        ) : d.habit?.unit && (
          <label className="field"><span className="field-label">Amount ({unit})</span>
            <input className="text-input" inputMode="decimal" value={v} onChange={(e) => setV(amountChars(e.target.value))} placeholder="0" />
          </label>
        )}
      </div>
      {had && <p className="muted small">Already logged{had.amount != null ? ` (${amountText(d, had.amount)})` : ""}: saving changes it.</p>}
      <div className="btn-row">
        <button type="submit" className="btn primary sm" disabled={!date || date > today}>Log</button>
        <button type="button" className="btn ghost sm" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
