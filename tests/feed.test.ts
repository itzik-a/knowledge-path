import { describe, expect, it } from "vitest";
import {
  cronLines, keptNotes, localParts, mergeFeedMarks, mergeFeedSettings, nextSummary, parseFeedSettings, parseMarks,
  scheduleWorkflow, seedFeedSettings, serializeMarks, serializeSettings, slotDue, waitingEntries, type Entry, type FeedFile,
} from "../shared/feed.ts";

// Israel: UTC+2 in winter, UTC+3 in summer (2026: summer from 27 March to 25 October).
const winter = (hhmm: string) => Date.parse(`2026-12-01T${hhmm}:00+02:00`);
const summer = (hhmm: string) => Date.parse(`2026-07-01T${hhmm}:00+03:00`);

describe("schedule", () => {
  it("reads Israel's local time in both seasons", () => {
    expect(localParts(winter("09:30"))).toEqual({ date: "2026-12-01", min: 570 });
    expect(localParts(summer("09:30"))).toEqual({ date: "2026-07-01", min: 570 });
  });

  it("lists each summary time at both offsets, and the 3-hourly reading", () => {
    expect(cronLines({ on: true, times: ["09:30"], read: true })).toEqual(["30 6 * * *", "30 7 * * *", "45 */3 * * *"]);
    expect(cronLines({ on: true, times: ["01:15"], read: false })).toEqual(["15 22 * * *", "15 23 * * *"]);
  });

  it("runs a summary time once a day, from its time until 3 hours after", () => {
    const times = ["09:30", "18:00"];
    expect(slotDue(winter("09:29"), times, [])).toBeUndefined();
    expect(slotDue(winter("09:30"), times, [])).toBe("09:30");
    expect(slotDue(summer("10:40"), times, [])).toBe("09:30"); // GitHub started it an hour late
    expect(slotDue(winter("12:31"), times, [])).toBeUndefined(); // too late: the next one is 18:00
    expect(slotDue(winter("18:05"), times, [])).toBe("18:00");
    const ran = [{ at: winter("09:41"), slot: "09:30" }];
    expect(slotDue(winter("10:30"), times, ran)).toBeUndefined();
    expect(slotDue(Date.parse("2026-12-02T09:35:00+02:00"), times, ran)).toBe("09:30"); // the next day
  });

  it("the other season's cron line falls outside the slot", () => {
    // 09:30 in winter: the summer line (06:30 UTC) is 08:30 local, too early; the winter one (07:30 UTC) is on time.
    expect(slotDue(Date.parse("2026-12-01T06:30:00Z"), ["09:30"], [])).toBeUndefined();
    expect(slotDue(Date.parse("2026-12-01T07:30:00Z"), ["09:30"], [])).toBe("09:30");
  });

  it("knows the next summary run", () => {
    expect(nextSummary(winter("08:00"), { on: true, times: ["09:30"], read: true })).toBe(winter("09:30"));
    expect(nextSummary(winter("10:00"), { on: true, times: ["09:30"], read: true })).toBe(Date.parse("2026-12-02T09:30:00+02:00"));
    expect(nextSummary(summer("08:00"), { on: true, times: ["09:30"], read: true })).toBe(summer("09:30"));
    expect(nextSummary(winter("08:00"), { on: false, times: ["09:30"], read: true })).toBeUndefined();
  });

  it("writes a workflow with those cron lines and the scheduled run", () => {
    const y = scheduleWorkflow({ on: true, times: ["09:30"], read: false });
    expect(y).toContain('- cron: "30 6 * * *"');
    expect(y).toContain('- cron: "30 7 * * *"');
    expect(y).not.toContain("*/3");
    expect(y).toContain("node .app/feed/run.ts --vault . --scheduled");
    expect(y).toContain("group: feed");
  });
});

describe("settings", () => {
  it("starts with the seed, automatic runs off", () => {
    const s = parseFeedSettings(undefined);
    expect(s.auto).toEqual({ on: false, times: ["09:30"], read: true });
    expect(s.sources.length).toBeGreaterThan(5);
    expect(s.keepDays).toBe(10);
  });

  it("round-trips, one item a line", () => {
    const s = seedFeedSettings();
    const text = serializeSettings(s);
    expect(parseFeedSettings(text).sources.map((x) => x.id).sort()).toEqual(s.sources.map((x) => x.id).sort());
    expect(text.split("\n").filter((l) => l.startsWith('{"id":')).length).toBe(s.sources.length + s.topics.length);
  });

  it("drops bad times, keeps at most three", () => {
    const s = parseFeedSettings(JSON.stringify({ auto: { on: true, times: ["25:00", "18:00", "07:00", "09:30", "12:00"] } }));
    expect(s.auto.times).toEqual(["07:00", "09:30", "12:00"]);
  });

  it("merges two devices item by item; prefs from the copy that changed them last", () => {
    const base = seedFeedSettings();
    const a = structuredClone(base), b = structuredClone(base);
    a.sources.find((x) => x.id === "ynet")!.enabled = false; a.sources.find((x) => x.id === "ynet")!.updatedAt = 10;
    b.sources.find((x) => x.id === "npr")!.deletedAt = 20; b.sources.find((x) => x.id === "npr")!.updatedAt = 20;
    b.topics.push({ id: "t1", name: "AI", description: "AI research", minScore: 60, enabled: true, updatedAt: 30 });
    a.auto = { on: true, times: ["08:00"], read: true }; a.prefsAt = 40;
    b.keepDays = 5; b.prefsAt = 35;
    const m = parseFeedSettings(mergeFeedSettings(serializeSettings(base), serializeSettings(a), serializeSettings(b)));
    expect(m.sources.find((x) => x.id === "ynet")!.enabled).toBe(false);
    expect(m.sources.find((x) => x.id === "npr")!.deletedAt).toBe(20);
    expect(m.topics.some((t) => t.id === "t1")).toBe(true);
    expect(m.auto.times).toEqual(["08:00"]);
    expect(m.keepDays).toBe(10); // a's prefs are newer, and a kept 10
  });
});

describe("marks", () => {
  const now = Date.parse("2026-11-28T12:00:00Z");
  it("merge entry by entry, the newer mark wins", () => {
    const a = serializeMarks({ e1: { s: "kept", path: "Resources/X.md", at: now - 10 }, e2: { s: "dismissed", at: now - 5 } }, now);
    const b = serializeMarks({ e2: { v: 1, at: now - 1 }, e3: { s: "dismissed", at: now - 3 } }, now);
    const m = parseMarks(mergeFeedMarks("{}", a, b, now));
    expect(m.e1).toEqual({ s: "kept", path: "Resources/X.md", at: now - 10 });
    expect(m.e2).toEqual({ v: 1, at: now - 1 });
    expect(m.e3.s).toBe("dismissed");
  });

  it("forget marks older than 60 days", () => {
    const text = serializeMarks({ old: { s: "dismissed", at: now - 61 * 86_400_000 }, fresh: { s: "kept", at: now } }, now);
    expect(Object.keys(parseMarks(text))).toEqual(["fresh"]);
  });

  it("are one a line", () => {
    const text = serializeMarks({ a: { s: "kept", at: now }, b: { s: "dismissed", at: now } }, now);
    expect(text.split("\n").filter((l) => l.startsWith('"')).length).toBe(2);
  });
});

describe("review", () => {
  const entry = (id: string, publishedAt: number, extra: Partial<Entry> = {}): Entry => ({
    id, title: id, tldr: "", bullets: [], lang: "en", topics: [], score: 0, sources: [], publishedAt, createdAt: publishedAt, updatedAt: publishedAt, ...extra,
  });
  it("waits on entries without a decision, newest first (a vote alone isn't a decision)", () => {
    const feed = { entries: [entry("a", 1), entry("b", 3), entry("c", 2)] } as FeedFile;
    expect(waitingEntries(feed, { b: { s: "dismissed", at: 1 }, c: { v: 1, at: 1 } }).map((e) => e.id)).toEqual(["c", "a"]);
  });

  it("gives a kept entry's notes: points, why, and its sources", () => {
    const e = entry("a", 1, {
      bullets: ["One", "Two"], why: "It matters",
      sources: [{ url: "https://a.com/1", title: "A", sourceId: "a", sourceName: "A", kind: "article", publishedAt: 1, basis: "full" },
        { url: "https://b.com/1", title: "B", sourceId: "b", sourceName: "B", kind: "article", publishedAt: 1, basis: "excerpt" }],
    });
    expect(keptNotes(e)).toBe("- One\n- Two\n\n**Why it matters:** It matters\n\nCovered by: [A](https://a.com/1) · [B](https://b.com/1)");
  });
});
