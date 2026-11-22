import { describe, expect, it } from "vitest";
import {
  habitOf, habitStats, isLogLine, mergeLogLines, newHabitBody, parseGoal, parseLog, setLogEntry, weekOf, type LogEntry,
} from "../shared/habits.ts";
import { buildIndex, itemsIn, parseDoc, type Doc } from "../shared/index.ts";
import { kindOf } from "../shared/vault.ts";

const log = (...dates: string[]): LogEntry[] => dates.map((date, line) => ({ date, line }));

describe("habit files", () => {
  it("are their own kind, only directly in Habits/", () => {
    expect(kindOf("Habits/Meditate.md")).toBe("habit");
    expect(kindOf("Habits/Old/Meditate.md")).toBe("note");
  });

  it("read goals loosely, daily by default", () => {
    expect(parseGoal(undefined)).toEqual({ per: "day" });
    expect(parseGoal("daily")).toEqual({ per: "day" });
    expect(parseGoal("3/week")).toEqual({ per: "week", times: 3 });
    expect(parseGoal("2 times a week")).toEqual({ per: "week", times: 2 });
    expect(parseGoal("4 per week")).toEqual({ per: "week", times: 4 });
    expect(parseGoal("weekly")).toEqual({ per: "week", times: 1 });
    expect(parseGoal("9/week")).toEqual({ per: "day" });
    expect(parseGoal("whenever")).toEqual({ per: "any" });
    expect(parseGoal("Anytime")).toEqual({ per: "any" });
    expect(parseGoal("sometimes")).toEqual({ per: "day" });
  });

  it("read the frontmatter, all of it optional", () => {
    expect(habitOf({})).toEqual({ icon: undefined, goal: { per: "day" }, unit: undefined, target: undefined, archived: false, timer: false });
    expect(habitOf({ icon: "🧘", goal: "3/week", unit: "min", target: "20", archived: true }))
      .toEqual({ icon: "🧘", goal: { per: "week", times: 3 }, unit: "min", target: 20, archived: true, timer: false });
  });

  it("are indexed with their log, and filed under topics", () => {
    const files: Record<string, string> = {
      "Topics/Philosophy.md": "",
      "Habits/Read.md": "---\ntopics: [\"[[Philosophy]]\"]\nunit: pages\n---\nA chapter a day.\n\n## Log\n\n- 2026-11-22: 30 pages\n- 2026-11-20\n",
    };
    const ix = buildIndex(new Map(Object.entries(files).map(([p, c]) => [p, parseDoc(p, c)] as [string, Doc])));
    const d = ix.docs.get("Habits/Read.md")!;
    expect(d.kind).toBe("habit");
    expect(d.habit?.unit).toBe("pages");
    expect(d.log).toEqual([{ date: "2026-11-22", amount: 30, line: 4 }, { date: "2026-11-20", amount: undefined, line: 5 }]);
    expect(d.excerpt).toBe("A chapter a day.");
    expect(itemsIn(ix, "Philosophy").map((x) => x.path)).toEqual(["Habits/Read.md"]);
  });
});

describe("the log", () => {
  it("parses dated lines, newest first, one per day, amounts with a decimal point or comma", () => {
    const body = "Intro\n\n## Log\n\n- 2026-11-20: 1,5 km\n- 2026-11-22: 20 min\n- not a log line\n- 2026-11-20: again\n* 2026-11-19\n\n## Other\n- 2026-01-01\n";
    expect(parseLog(body).map((e) => [e.date, e.amount])).toEqual([["2026-11-22", 20], ["2026-11-20", 1.5], ["2026-11-19", undefined]]);
    expect(parseLog("no log here\n- 2026-11-22")).toEqual([]);
    expect(isLogLine("- 2026-11-22: 3")).toBe(true);
    expect(isLogLine("- [ ] 2026-11-22")).toBe(false);
  });

  it("logs into a new habit's empty section", () => {
    const b = setLogEntry(newHabitBody("Every morning."), "2026-11-22", undefined);
    expect(b).toBe("Every morning.\n\n## Log\n\n- 2026-11-22\n");
  });

  it("makes the section when it's missing", () => {
    expect(setLogEntry("Some text\n", "2026-11-22", 20, "min")).toBe("Some text\n\n## Log\n\n- 2026-11-22: 20 min\n");
    expect(setLogEntry("", "2026-11-22", undefined)).toBe("## Log\n\n- 2026-11-22\n");
  });

  it("keeps newest first when logging another day, including backfilled ones", () => {
    let b = "## Log\n\n- 2026-11-22\n- 2026-11-18\n\n## Notes\nkeep me\n";
    b = setLogEntry(b, "2026-11-20", 3);
    b = setLogEntry(b, "2026-11-23", undefined);
    b = setLogEntry(b, "2026-11-01", undefined);
    expect(b).toBe("## Log\n\n- 2026-11-23\n- 2026-11-22\n- 2026-11-20: 3\n- 2026-11-18\n- 2026-11-01\n\n## Notes\nkeep me\n");
  });

  it("changes a day's amount in place, and removes a day", () => {
    const b = "## Log\n\n- 2026-11-22: 10 min\n- 2026-11-21\n";
    expect(setLogEntry(b, "2026-11-22", 25, "min")).toBe("## Log\n\n- 2026-11-22: 25 min\n- 2026-11-21\n");
    expect(setLogEntry(b, "2026-11-22", null)).toBe("## Log\n\n- 2026-11-21\n");
    expect(setLogEntry(b, "2026-11-01", null)).toBe(b);
  });

  it("a section with only text in it gets the list after a blank line", () => {
    expect(setLogEntry("## Log\nnothing yet", "2026-11-22", undefined)).toBe("## Log\n\n- 2026-11-22\n\nnothing yet\n");
  });
});

describe("merging two devices' logs", () => {
  it("keeps the days logged on either side, newest first", () => {
    expect(mergeLogLines(["- 2026-11-22"], [], ["- 2026-11-21"])).toEqual(["- 2026-11-22", "- 2026-11-21"]);
  });
  it("a day removed on one side and untouched on the other goes", () => {
    expect(mergeLogLines(["- 2026-11-22", "- 2026-11-20"], ["- 2026-11-21", "- 2026-11-20"], ["- 2026-11-21"]))
      .toEqual(["- 2026-11-22"]);
  });
  it("a day changed on both sides keeps mine; changed on one side keeps that change", () => {
    expect(mergeLogLines(["- 2026-11-22: 30"], ["- 2026-11-22: 10"], ["- 2026-11-22: 20"])).toEqual(["- 2026-11-22: 30"]);
    expect(mergeLogLines(["- 2026-11-22: 10", "- 2026-11-23"], ["- 2026-11-22: 10"], ["- 2026-11-22: 20"])).toEqual(["- 2026-11-23", "- 2026-11-22: 20"]);
  });
  it("refuses anything that isn't log lines", () => {
    expect(mergeLogLines(["- 2026-11-22"], [], ["Some text"])).toBeNull();
    expect(mergeLogLines([""], [], [""])).toBeNull();
  });
});

describe("streaks", () => {
  const today = "2026-11-22"; // a Sunday
  it("weeks start on Monday", () => {
    expect(weekOf("2026-11-22")).toBe("2026-11-16");
    expect(weekOf("2026-11-16")).toBe("2026-11-16");
    expect(weekOf("2026-11-23")).toBe("2026-11-23");
  });

  it("daily: counts back from today, or from yesterday until today is logged", () => {
    const s = habitStats({ per: "day" }, log("2026-11-22", "2026-11-21", "2026-11-20", "2026-11-17", "2026-11-16", "2026-11-15", "2026-11-14"), today);
    expect(s).toMatchObject({ current: 3, best: 4, unit: "day", doneToday: true, thisWeek: 5, last30: 7 });
    expect(habitStats({ per: "day" }, log("2026-11-21", "2026-11-20"), today)).toMatchObject({ current: 2, doneToday: false });
    expect(habitStats({ per: "day" }, log("2026-11-20"), today).current).toBe(0);
    expect(habitStats({ per: "day" }, [], today)).toMatchObject({ current: 0, best: 0, last30: 0 });
  });

  it("daily: across a month end", () => {
    expect(habitStats({ per: "day" }, log("2026-12-01", "2026-11-30", "2026-11-29"), "2026-12-01").current).toBe(3);
  });

  it("weekly: whole weeks that met the goal; this week counts once it's met", () => {
    const goal = { per: "week" as const, times: 2 };
    // this week (16–22): 1, last week (9–15): 2, the week before (2–8): 3, before that (26 Oct–1 Nov): 0
    const l = log("2026-11-20", "2026-11-13", "2026-11-10", "2026-11-08", "2026-11-04", "2026-11-02");
    expect(habitStats(goal, l, today)).toMatchObject({ current: 2, best: 2, unit: "week", thisWeek: 1 });
    expect(habitStats(goal, [...l, { date: "2026-11-21", line: 9 }], today)).toMatchObject({ current: 3, best: 3, thisWeek: 2 });
  });

  it("whenever: no streak, still counts this week and the last 30 days", () => {
    const l: LogEntry[] = [{ date: "2026-11-21", amount: 16, line: 0 }, { date: "2026-11-18", amount: 14.5, line: 1 }, { date: "2026-11-10", amount: 18, line: 2 }];
    expect(habitStats({ per: "any" }, l, today)).toMatchObject({ current: 0, best: 0, doneToday: false, thisWeek: 2, last30: 3, total30: 48.5 });
  });

  it("sums amounts over the last 30 days, and ignores days after today", () => {
    const l: LogEntry[] = [{ date: "2026-11-22", amount: 20, line: 0 }, { date: "2026-10-24", amount: 10, line: 1 }, { date: "2026-10-23", amount: 99, line: 2 }, { date: "2026-11-25", amount: 5, line: 3 }];
    expect(habitStats({ per: "day" }, l, today)).toMatchObject({ last30: 2, total30: 30, current: 1 });
  });
});

describe("the description", () => {
  it("is the text above the log, and can be replaced without touching the log", async () => {
    const { habitIntro, setHabitIntro } = await import("../shared/habits.ts");
    const b = "Ten minutes.\n\n## Log\n\n- 2026-11-22\n";
    expect(habitIntro(b)).toBe("Ten minutes.");
    expect(setHabitIntro(b, "Twenty minutes, before the phone.")).toBe("Twenty minutes, before the phone.\n\n## Log\n\n- 2026-11-22\n");
    expect(setHabitIntro(b, "")).toBe("## Log\n\n- 2026-11-22\n");
    expect(setHabitIntro("Only text", "New")).toBe("New\n\n## Log\n\n");
  });
});

describe("timed habits (a fast)", () => {
  it("read timer and started, only for a timed habit, and accept Obsidian's date-time forms", async () => {
    const { parseStamp } = await import("../shared/habits.ts");
    expect(habitOf({ timer: true, unit: "h", target: 16, started: "2026-11-22T20:00" })).toMatchObject({ timer: true, unit: "h", target: 16, started: "2026-11-22T20:00" });
    expect(habitOf({ started: "2026-11-22T20:00" })).toMatchObject({ timer: false, started: undefined });
    expect(parseStamp("2026-11-22 8:05:30")).toBe("2026-11-22T08:05");
    expect(parseStamp(new Date(2026, 10, 22, 20, 0))).toBe("2026-11-22T20:00");
    expect(parseStamp("2026-11-22")).toBeUndefined();
    expect(parseStamp("2026-02-31T10:00")).toBeUndefined();
    expect(parseStamp("2026-11-22T25:00")).toBeUndefined();
    expect(parseStamp(42)).toBeUndefined();
  });

  it("count hours to the minute and write them as hours and minutes", async () => {
    const { hoursSince, fmtHours, parseHours } = await import("../shared/habits.ts");
    expect(hoursSince("2026-11-22T20:00", new Date(2026, 10, 23, 12, 20, 59))).toBe(16.33);
    expect(hoursSince("2026-11-22T20:00", new Date(2026, 10, 22, 19, 0))).toBe(0);
    expect(fmtHours(16.33)).toBe("16 h 20 m");
    expect(fmtHours(16)).toBe("16 h");
    expect(fmtHours(0.75)).toBe("45 m");
    expect(parseHours("16:30")).toBe(16.5);
    expect(parseHours("16,5")).toBe(16.5);
    expect(parseHours("16")).toBe(16);
    expect(parseHours("16:")).toBe(16);
    expect(parseHours("0:45")).toBe(0.75);
    expect(parseHours("0")).toBeUndefined();
    expect(parseHours("abc")).toBeUndefined();
  });

  it("ending the timer logs the hours on the day it ends and removes started, keeping the rest of the file", async () => {
    const { endTimerIn } = await import("../shared/habits.ts");
    const file = "---\nicon: ⏳\n# my fasts\ntimer: true\nunit: h\ntarget: 16\nstarted: 2026-11-22T20:00\n---\n16:8.\n\n## Log\n\n- 2026-11-22: 15.5 h\n";
    const r = endTimerIn(file, new Date(2026, 10, 23, 12, 30))!;
    expect(r).toMatchObject({ date: "2026-11-23", hours: 16.5, prev: undefined });
    expect(r.text).toBe("---\nicon: ⏳\n# my fasts\ntimer: true\nunit: h\ntarget: 16\n---\n16:8.\n\n## Log\n\n- 2026-11-23: 16.5 h\n- 2026-11-22: 15.5 h\n");
    const again = endTimerIn(r.text.replace("target: 16\n", "target: 16\nstarted: 2026-11-23T13:00\n"), new Date(2026, 10, 23, 15, 0))!;
    expect(again.prev).toMatchObject({ date: "2026-11-23", amount: 16.5 });
    expect(again.text).toContain("- 2026-11-23: 2 h\n");
    expect(endTimerIn(r.text, new Date())).toBeNull();
  });

  it("a timed habit indexes like any other, its log in hours", () => {
    const d = parseDoc("Habits/Fast.md", "---\ntimer: true\nunit: h\ntarget: 16\nstarted: 2026-11-22T20:00\n---\n## Log\n\n- 2026-11-22: 16.33 h\n");
    expect(d.habit).toMatchObject({ timer: true, started: "2026-11-22T20:00", target: 16 });
    expect(d.log).toEqual([{ date: "2026-11-22", amount: 16.33, line: 2 }]);
  });
});
