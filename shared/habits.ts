/* Habits: one file per habit in Habits/, with its log as a "## Log" section of dated lines, newest first.

     ---
     icon: 🧘
     goal: daily          (or "3/week"; daily when missing)
     unit: min            (optional: each day can log an amount)
     target: 20           (optional: the amount a day is filled in with)
     topics: ["[[Stoicism]]"]
     archived: true       (optional: hidden from Home)
     ---
     Ten minutes every morning.

     ## Log

     - 2026-11-22: 20 min
     - 2026-11-21

   Plain Markdown, so Obsidian shows it as a list. Used by the app and the enricher (no DOM or Node APIs). */

export type Goal = { per: "day" } | { per: "week"; times: number };

export interface Habit {
  icon?: string;
  goal: Goal;
  unit?: string;
  target?: number;
  archived: boolean;
}

export interface LogEntry { date: string; amount?: number; line: number }

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const posNum = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** "daily", "3/week", "3 per week", "weekly" (once a week). Anything else is daily. */
export function parseGoal(v: unknown): Goal {
  if (typeof v !== "string") return { per: "day" };
  const s = v.trim().toLowerCase();
  if (s === "weekly") return { per: "week", times: 1 };
  const m = /^(\d+)\s*(?:\/|x|times?(?:\s+(?:a|per))?|per)\s*w(?:ee)?k$/.exec(s);
  if (m) {
    const times = Math.round(Number(m[1]));
    if (times >= 1 && times < 7) return { per: "week", times };
  }
  return { per: "day" };
}

export const goalText = (g: Goal) => (g.per === "day" ? "daily" : `${g.times}/week`);
export const goalLabel = (g: Goal) => (g.per === "day" ? "Every day" : g.times === 1 ? "Once a week" : `${g.times} times a week`);

export function habitOf(fm: Record<string, unknown>): Habit {
  return {
    icon: str(fm.icon),
    goal: parseGoal(fm.goal),
    unit: str(fm.unit),
    target: posNum(fm.target),
    archived: fm.archived === true,
  };
}

// ── The log section ───────────────────────────────────────────

const LOG_HEAD = /^##\s+log\s*$/i;
export const LOG_LINE = /^[-*+] (\d{4}-\d{2}-\d{2})(?:\s*:\s*(.*))?\s*$/;

/** A log line, e.g. "- 2026-11-22: 20 min". */
export const isLogLine = (l: string) => LOG_LINE.test(l);

/** Line range [start, end) of the Log section's content, or null. */
function logSection(lines: string[]): [number, number] | null {
  const h = lines.findIndex((l) => LOG_HEAD.test(l.trim()));
  if (h < 0) return null;
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) { end = i; break; }
  return [h + 1, end];
}

/** The log, newest first, one entry per day (the first line for a day wins). `line` is the body line. */
export function parseLog(body: string): LogEntry[] {
  const lines = body.split("\n");
  const sec = logSection(lines);
  if (!sec) return [];
  const seen = new Set<string>();
  const out: LogEntry[] = [];
  for (let i = sec[0]; i < sec[1]; i++) {
    const m = LOG_LINE.exec(lines[i]);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const a = m[2] ? /^(\d+(?:[.,]\d+)?)/.exec(m[2].trim()) : null;
    const amount = a ? Number(a[1].replace(",", ".")) : undefined;
    out.push({ date: m[1], amount: amount != null && Number.isFinite(amount) ? amount : undefined, line: i });
  }
  return out.sort((x, y) => y.date.localeCompare(x.date));
}

export const fmtAmount = (n: number) => String(Math.round(n * 100) / 100);

export function logLine(date: string, amount?: number, unit?: string): string {
  return amount == null ? `- ${date}` : `- ${date}: ${fmtAmount(amount)}${unit ? ` ${unit}` : ""}`;
}

/** Log a day (replacing that day's line), or remove it with `amount === null`. Keeps the log newest first. */
export function setLogEntry(body: string, date: string, amount: number | undefined | null, unit?: string): string {
  const lines = body.split("\n");
  const sec = logSection(lines);
  const existing = sec ? lines.slice(sec[0], sec[1]).map((l, i) => ({ m: LOG_LINE.exec(l), i: sec![0] + i })).filter((x) => x.m) : [];
  const same = existing.filter((x) => x.m![1] === date).map((x) => x.i);
  if (amount === null) {
    if (!same.length) return body;
    for (const i of [...same].reverse()) lines.splice(i, 1);
    return lines.join("\n");
  }
  const line = logLine(date, amount, unit);
  if (same.length) {
    lines[same[0]] = line;
    for (const i of same.slice(1).reverse()) lines.splice(i, 1);
    return lines.join("\n");
  }
  if (!sec) {
    const t = body.replace(/\s+$/, "");
    return `${t ? t + "\n\n" : ""}## Log\n\n${line}\n`;
  }
  // before the first older entry, else after the last entry, else first in the section
  const older = existing.find((x) => x.m![1] < date);
  if (older) lines.splice(older.i, 0, line);
  else if (existing.length) lines.splice(existing[existing.length - 1].i + 1, 0, line);
  else {
    const at = sec[0];
    if (at >= lines.length) lines.push("", line);
    else if (!lines[at].trim()) lines.splice(at + 1, 0, line, ...(at + 1 < lines.length && lines[at + 1].trim() ? [""] : []));
    else lines.splice(at, 0, "", line, "");
  }
  const out = lines.join("\n");
  return out.endsWith("\n") ? out : out + "\n";
}

/** Merge two devices' versions of the same run of log lines (from a three-way merge's clash): every day either
    side logged stays, a day either side removed goes, and a day both changed keeps mine. Null if the run has
    anything other than log lines and blanks. */
export function mergeLogLines(mine: string[], base: string[], theirs: string[]): string[] | null {
  const all = [...mine, ...base, ...theirs];
  if (!all.some((l) => l.trim()) || !all.every((l) => !l.trim() || isLogLine(l))) return null;
  const byDate = (ls: string[]) => {
    const m = new Map<string, string>();
    for (const l of ls) { const x = LOG_LINE.exec(l); if (x && !m.has(x[1])) m.set(x[1], l); }
    return m;
  };
  const a = byDate(mine), o = byDate(base), b = byDate(theirs);
  const out = new Map<string, string>();
  for (const d of new Set([...a.keys(), ...b.keys()])) {
    const inA = a.get(d), inB = b.get(d), inO = o.get(d);
    if (inA != null && inB != null) out.set(d, inA !== inO ? inA : inB);
    else if (inA != null) { if (inO == null || inO !== inA) out.set(d, inA); } // theirs removed it unless I changed it
    else if (inB != null) { if (inO == null || inO !== inB) out.set(d, inB); }
  }
  const lines = [...out].sort((x, y) => y[0].localeCompare(x[0])).map(([, l]) => l);
  // keep a trailing blank line if both sides had one
  if (mine.length && !mine[mine.length - 1].trim() && theirs.length && !theirs[theirs.length - 1].trim()) lines.push("");
  return lines;
}

// ── Streaks ───────────────────────────────────────────────────

/** Whole days since 1970 for a YYYY-MM-DD (no time zones involved). */
export const dayNum = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, dd) / 864e5); };
export const dayStr = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
export const shiftDay = (d: string, n: number) => dayStr(dayNum(d) + n);
/** The Monday of a day's week. */
export const weekOf = (d: string) => { const n = dayNum(d); return dayStr(n - ((new Date(n * 864e5).getUTCDay() + 6) % 7)); };

export interface HabitStats {
  /** In days for a daily habit, in weeks for a weekly one. */
  current: number;
  best: number;
  unit: "day" | "week";
  doneToday: boolean;
  /** Days logged this week (Monday to today). */
  thisWeek: number;
  /** Days logged in the last 30 days (today included). */
  last30: number;
  /** Sum of the amounts logged in the last 30 days. */
  total30: number;
}

export function habitStats(goal: Goal, log: LogEntry[], today: string): HabitStats {
  const days = new Set(log.map((e) => e.date).filter((d) => d <= today));
  const t = dayNum(today);
  const from30 = t - 29;
  let last30 = 0, total30 = 0;
  for (const e of log) {
    const n = dayNum(e.date);
    if (n >= from30 && n <= t) { last30++; total30 += e.amount ?? 0; }
  }
  const mon = dayNum(weekOf(today));
  let thisWeek = 0;
  for (let n = mon; n <= t; n++) if (days.has(dayStr(n))) thisWeek++;
  const doneToday = days.has(today);

  if (goal.per === "day") {
    // still going if today isn't logged yet but yesterday was
    let current = 0;
    for (let n = doneToday ? t : t - 1; days.has(dayStr(n)); n--) current++;
    let best = 0, run = 0, prev = NaN;
    for (const n of [...days].map(dayNum).sort((a, b) => a - b)) { run = n === prev + 1 ? run + 1 : 1; prev = n; best = Math.max(best, run); }
    return { current, best, unit: "day", doneToday, thisWeek, last30, total30 };
  }

  const perWeek = new Map<number, number>();
  for (const d of days) { const w = dayNum(weekOf(d)); perWeek.set(w, (perWeek.get(w) ?? 0) + 1); }
  const met = (w: number) => (perWeek.get(w) ?? 0) >= goal.times;
  // this week counts once it's met; until then the streak runs to last week
  let current = 0;
  for (let w = met(mon) ? mon : mon - 7; met(w); w -= 7) current++;
  let best = 0, run = 0, prev = NaN;
  for (const w of [...perWeek.keys()].filter(met).sort((a, b) => a - b)) { run = w === prev + 7 ? run + 1 : 1; prev = w; best = Math.max(best, run); }
  return { current, best, unit: "week", doneToday, thisWeek, last30, total30 };
}

/** The starter content of a new habit file's body. */
export const newHabitBody = (description?: string) => `${description?.trim() ? description.trim() + "\n\n" : ""}## Log\n\n`;

/** The text above the log (the habit's description). */
export function habitIntro(body: string): string {
  const lines = body.split("\n");
  const h = lines.findIndex((l) => LOG_HEAD.test(l.trim()));
  return (h < 0 ? body : lines.slice(0, h).join("\n")).trim();
}

/** Replace the text above the log, keeping the log and anything after it. */
export function setHabitIntro(body: string, text: string): string {
  const lines = body.split("\n");
  const h = lines.findIndex((l) => LOG_HEAD.test(l.trim()));
  const rest = h < 0 ? "## Log\n\n" : lines.slice(h).join("\n");
  return `${text.trim() ? text.trim() + "\n\n" : ""}${rest}`;
}
