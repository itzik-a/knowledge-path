/* #habits: every habit with today's check and the last 7 days; and one habit's page (#doc/Habits/<name>.md):
   streaks, the last 7 days to tap, the calendar, the log, its description and topics. */
import { useMemo, useState } from "react";
import type { Doc, Index } from "../../shared/index.ts";
import { fmtHours, goalLabel, habitIntro, isMinutesHabit } from "../../shared/habits.ts";
import { todayISO } from "../../shared/vault.ts";
import { TopicPicker } from "../components/bits";
import { amountText, habitIcon, HabitRow, Heatmap, LogList, SessionCard, statsOf, TimerCard, WeekStrip } from "../components/habits";
import { IconBack, IconMore, IconPlus } from "../components/Icons";
import { Markdown } from "../components/Markdown";
import { Menu, useMedia } from "../components/ui";
import { back } from "../lib/route";
import { openSheet } from "../lib/sheets";
import { deleteDocs, pinItem, setArchived, setTopics } from "../state/actions";
import { useIndex } from "../state/store";

export const habitsOf = (ix: Index) => [...ix.docs.values()].filter((d) => d.kind === "habit").sort((a, b) => a.title.localeCompare(b.title));

export function Habits() {
  const ix = useIndex();
  const all = useMemo(() => habitsOf(ix), [ix]);
  const active = all.filter((d) => !d.habit!.archived);
  const archived = all.filter((d) => d.habit!.archived);
  const [showArchived, setShowArchived] = useState(false);
  const today = todayISO();
  const done = active.filter((d) => d.log?.some((e) => e.date === today)).length;

  return (
    <>
      <div className="page-head row-head">
        <div>
          <h1 className="display">Habits</h1>
          {active.length > 0 && <p className="muted">{done} of {active.length} done today</p>}
        </div>
        <button type="button" className="btn primary sm" onClick={() => openSheet({ kind: "habit" })}><IconPlus /> New habit</button>
      </div>

      {active.length ? (
        <section className="card">
          <ul className="item-list habit-list">{active.map((d) => <HabitRow key={d.path} d={d} strip />)}</ul>
        </section>
      ) : (
        <section className="card empty">
          <h2>No habits yet</h2>
          <p className="muted">Something you want to do every day, or a few times a week: meditate, read 20 pages, write in the journal. Tap the circle to log the day, and the streak keeps count.</p>
          <p className="muted small">Each habit is a note in <code>Habits/</code>, and each day you log is a line in it.</p>
          <button type="button" className="btn primary" onClick={() => openSheet({ kind: "habit" })}><IconPlus /> New habit</button>
        </section>
      )}

      {archived.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Archived <span className="muted">· {archived.length}</span></h2>
            <button type="button" className="btn ghost sm" onClick={() => setShowArchived((x) => !x)}>{showArchived ? "Hide" : "Show"}</button>
          </div>
          {showArchived && <ul className="item-list habit-list">{archived.map((d) => <HabitRow key={d.path} d={d} />)}</ul>}
        </section>
      )}
    </>
  );
}

export function HabitPage({ d, ix }: { d: Doc; ix: Index }) {
  const h = d.habit!;
  const s = statsOf(d);
  const wide = useMedia("(min-width: 768px)");
  const intro = habitIntro(d.body);
  const unitWord = (n: number) => `${n} ${s.unit}${n === 1 ? "" : "s"}`;
  const named = d.topicRefs.map((r) => ix.topicOrder.find((id) => id.toLowerCase() === r.toLowerCase() || ix.topics.get(id)!.name.toLowerCase() === r.toLowerCase())).filter((x): x is string => !!x);
  const fixed = (ix.topicsOf.get(d.path) ?? []).filter((id) => !named.includes(id));

  return (
    <>
      <button type="button" className="back link-row" onClick={() => back("#habits")}><IconBack /> Habits</button>
      <section className="card">
        <div className="note-head">
          <span className="topic-icon big" aria-hidden="true">{habitIcon(d)}</span>
          <div className="grow">
            <span className="eyebrow">{goalLabel(h.goal)}{h.timer ? " · timed" : h.unit && h.unit !== "times" ? ` · in ${h.unit}` : ""}{h.archived ? " · Archived" : ""}</span>
            <h1 className="display" dir="auto">{d.title}</h1>
          </div>
          <div className="head-tools">
            <button type="button" className="btn ghost sm" onClick={() => openSheet({ kind: "habit", path: d.path })}>Edit</button>
            <Menu label="More" icon={<IconMore />} items={[
              pinItem(d),
              { label: h.archived ? "Back on Home" : "Archive", run: () => setArchived(d.path, !h.archived) },
              { label: "Delete", danger: true, run: async () => { if (await deleteDocs([d.path], `“${d.title}” and its log`)) back("#habits"); } },
            ]} />
          </div>
        </div>
        {intro && <Markdown body={intro} from={d.path} />}
        <TopicPicker value={named} onChange={(ids) => setTopics(d.path, ids)} fixed={fixed} />

        <dl className="stat-row">
          {h.goal.per === "any"
            ? <div><dt>This week</dt><dd>{s.thisWeek}</dd></div>
            : <>
              <div><dt>Streak</dt><dd>{unitWord(s.current)}</dd></div>
              <div><dt>Best</dt><dd>{unitWord(s.best)}</dd></div>
            </>}
          {h.goal.per === "week"
            ? <div><dt>This week</dt><dd>{s.thisWeek} of {h.goal.times}</dd></div>
            : <div><dt>Last 30 days</dt><dd>{s.last30} {s.last30 === 1 ? "day" : "days"}</dd></div>}
          {h.timer
            ? s.last30 > 0 && s.total30 > 0 && <div><dt>30-day average</dt><dd>{fmtHours(s.total30 / s.last30)}</dd></div>
            : h.unit && s.total30 > 0 && <div><dt>30-day total</dt><dd>{amountText(d, s.total30)}</dd></div>}
        </dl>
      </section>

      {h.timer && <TimerCard d={d} />}
      {isMinutesHabit(h) && <SessionCard d={d} />}

      <section className="card">
        <h2>Last 7 days</h2>
        <WeekStrip d={d} />
      </section>

      <section className="card">
        <h2>{wide ? "Last 6 months" : "Last 4 months"}</h2>
        <Heatmap d={d} weeks={wide ? 26 : 16} />
      </section>

      <LogList d={d} />
    </>
  );
}
