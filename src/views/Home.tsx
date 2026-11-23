/* #home: today's journal entry, what I'm in the middle of, what's next, the inbox, a highlight to revisit, and the topics. */
import { useMemo } from "react";
import { inbox, itemsIn, type Doc } from "../../shared/index.ts";
import { journalPath, parseHighlights, todayISO } from "../../shared/vault.ts";
import { ResourceRow, topicColor } from "../components/bits";
import { HabitRow } from "../components/habits";
import { habitsOf } from "./Habits";
import { recipesOf } from "./Recipes";
import { shoppingLeft } from "./Shopping";
import { SHOPPING_PATH } from "../../shared/shopping.ts";
import { RecipeRow } from "../components/recipes";
import { addDays } from "../lib/dates";
import { IconCart, IconHabit, IconRecipe, IconInbox, IconJournal, IconPlus, IconQuote } from "../components/Icons";
import { Markdown } from "../components/Markdown";
import { useLocalState } from "../components/ui";
import { greeting, longDate } from "../lib/dates";
import { docHref, topicHref } from "../lib/route";
import { openSheet } from "../lib/sheets";
import { useIndex } from "../state/store";

/** The same highlight all day, a different one tomorrow. */
function dailyPick<T>(list: T[], day: string): T | undefined {
  if (!list.length) return undefined;
  let h = 0;
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

export function Home() {
  const ix = useIndex();
  const today = todayISO();
  const entry = ix.docs.get(journalPath(today));
  const [introDone, setIntroDone] = useLocalState("knowledgePath.introDone", false);

  const resources = useMemo(() => [...ix.docs.values()].filter((d) => d.kind === "resource"), [ix]);
  const now = resources.filter((d) => d.resource!.status === "in-progress").sort((a, b) => b.mtime - a.mtime);
  const next = resources.filter((d) => d.resource!.status === "next").sort((a, b) => b.mtime - a.mtime);
  const recent = [...resources].filter((d) => d.resource!.status === "saved").sort((a, b) => (b.resource!.added ?? "").localeCompare(a.resource!.added ?? "") || b.mtime - a.mtime).slice(0, 4);
  const waiting = inbox(ix).length;
  const hl = useMemo(() => {
    const all: { d: Doc; quote: string; comment?: string }[] = [];
    for (const d of resources) for (const h of parseHighlights(d.body)) all.push({ d, quote: h.quote, comment: h.comment });
    return dailyPick(all, today);
  }, [resources, today]);
  const top = ix.topicOrder.map((id) => ix.topics.get(id)!).filter((t) => !t.parent);
  const allHabits = useMemo(() => habitsOf(ix), [ix]);
  const habits = allHabits.filter((d) => !d.habit!.archived);
  // a habit with no schedule ("whenever") is never due, so it isn't counted in "N of M today"
  const due = habits.filter((d) => d.habit!.goal.per !== "any");
  const habitsDone = due.filter((d) => d.log?.some((e) => e.date === today)).length;
  const recipes = useMemo(() => recipesOf(ix), [ix]);
  // made before, not in the last three weeks: the favourites first
  const again = useMemo(() => {
    const before = addDays(today, -21);
    const old = recipes.filter((d) => d.cooking?.cooked.length && d.cooking.cooked[0] < before)
      .sort((a, b) => b.cooking!.cooked.length - a.cooking!.cooked.length || (b.recipe!.rating ?? 0) - (a.recipe!.rating ?? 0));
    return (old.length ? old : [...recipes].sort((a, b) => String(b.fm.added ?? "").localeCompare(String(a.fm.added ?? "")) || b.mtime - a.mtime)).slice(0, 3);
  }, [recipes, today]);
  const againOld = again.some((d) => d.cooking?.cooked.length);
  const toBuy = shoppingLeft(ix.docs.get(SHOPPING_PATH)?.body);

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{longDate(today)}</span>
        <h1 className="display">{greeting()}</h1>
      </div>

      {!introDone && (
        <section className="card note-card intro">
          <p>
            <b>Your knowledge hub.</b> Topics hold everything: saved links, books and videos, your notes, journal entries that mention them, and study paths.
            Add anything with <b>+</b>. Anything without a topic waits in the Inbox. It's all Markdown, and opens in Obsidian too.
          </p>
          <button type="button" className="btn sm" onClick={() => setIntroDone(true)}>Got it</button>
        </section>
      )}

      {habits.length > 0 ? (
        <section className="card">
          <div className="card-head">
            <h2>Habits{due.length > 0 && <span className="muted"> · {habitsDone} of {due.length} today</span>}</h2>
            <a className="link" href="#habits">All</a>
          </div>
          <ul className="item-list habit-list">{habits.map((d) => <HabitRow key={d.path} d={d} />)}</ul>
        </section>
      ) : allHabits.length === 0 && (
        <a className="card journal-card" href="#habits">
          <span className="journal-icon"><IconHabit /></span>
          <span className="grow"><b>Track a habit</b><span className="muted small">Something to do every day, or a few times a week.</span></span>
          <span className="chev">›</span>
        </a>
      )}

      {recipes.length > 0 ? (
        <section className="card">
          <div className="card-head">
            <h2>Recipes{againOld && <span className="muted"> · cook again</span>}</h2>
            <a className="link" href="#recipes">All {recipes.length}</a>
          </div>
          <ul className="item-list">{again.map((d) => <RecipeRow key={d.path} d={d} ix={ix} showTopics={false} />)}</ul>
          {toBuy > 0 && <a className="link small shop-link" href="#shopping"><IconCart width={16} height={16} /> Shopping list · {toBuy} to buy</a>}
        </section>
      ) : (
        <a className="card journal-card" href="#recipes">
          <span className="journal-icon"><IconRecipe /></span>
          <span className="grow"><b>Save a recipe</b><span className="muted small">Paste a link or write it down; scale it and cook from it step by step.</span></span>
          <span className="chev">›</span>
        </a>
      )}

      <a className="card journal-card" href={docHref(journalPath(today))}>
        <span className="journal-icon"><IconJournal /></span>
        <span className="grow">
          <b>{entry ? "Today's entry" : "Write today's entry"}</b>
          <span className="muted small clamp" dir="auto">{entry?.excerpt || "What are you reading, thinking, noticing?"}</span>
        </span>
        <span className="chev">›</span>
      </a>

      {waiting > 0 && (
        <a className="card inbox-banner" href="#inbox"><IconInbox /> <span className="grow"><b>{waiting} in the Inbox</b> <span className="muted">waiting for a topic</span></span><span className="chev">›</span></a>
      )}

      {now.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>In progress</h2><a className="link" href="#library">Library</a></div>
          <ul className="item-list">{now.slice(0, 5).map((d) => <ResourceRow key={d.path} d={d} ix={ix} />)}</ul>
        </section>
      )}

      {next.length > 0 && (
        <section className="card">
          <h2>Up next</h2>
          <ul className="item-list">{next.slice(0, 4).map((d) => <ResourceRow key={d.path} d={d} ix={ix} />)}</ul>
        </section>
      )}

      {hl && (
        <section className="card hl-card">
          <span className="eyebrow"><IconQuote width={14} height={14} /> From your highlights</span>
          <blockquote dir="auto">{hl.quote}</blockquote>
          {hl.comment && <Markdown body={hl.comment} from={hl.d.path} className="muted small" />}
          <a className="link small" href={docHref(hl.d.path)} dir="auto">{hl.d.title}{hl.d.resource?.author ? `, ${hl.d.resource.author}` : ""}</a>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>Topics</h2><a className="link" href="#topics">All</a></div>
        <ul className="topic-list">
          {top.map((t) => {
            const items = itemsIn(ix, t.id);
            const active = items.filter((d) => d.resource?.status === "in-progress").length;
            return (
              <li key={t.id}>
                <a href={topicHref(t.id)} style={{ ["--tc" as string]: topicColor(t) }}>
                  <span className="topic-icon" aria-hidden="true">{t.icon ?? "•"}</span>
                  <span className="grow"><b dir="auto">{t.name}</b><span className="muted small">{items.length} items{active ? ` · ${active} in progress` : ""}</span></span>
                  <span className="chev">›</span>
                </a>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn ghost sm" onClick={() => openSheet({ kind: "topic" })}><IconPlus /> Topic</button>
      </section>

      {recent.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Recently saved</h2><a className="link" href="#library">All</a></div>
          <ul className="item-list">{recent.map((d) => <ResourceRow key={d.path} d={d} ix={ix} />)}</ul>
        </section>
      )}
    </>
  );
}
