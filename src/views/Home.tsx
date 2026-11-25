/* #home: what I pinned, today's journal entry, what I'm in the middle of, what's next, and a highlight to revisit. */
import { useMemo, type ReactNode } from "react";
import { pinnedDocs, type Doc } from "../../shared/index.ts";
import { journalPath, parseHighlights, todayISO } from "../../shared/vault.ts";
import { DocRow, ResourceRow } from "../components/bits";
import { HabitRow } from "../components/habits";
import { habitsOf } from "./Habits";
import { recipesOf } from "./Recipes";
import { shoppingLeft } from "./Shopping";
import { SHOPPING_PATH } from "../../shared/shopping.ts";
import { RecipeRow } from "../components/recipes";
import { addDays } from "../lib/dates";
import { IconCart, IconChevronDown, IconHabit, IconPin, IconRecipe, IconJournal, IconQuote } from "../components/Icons";
import { Markdown } from "../components/Markdown";
import { useLocalState } from "../components/ui";
import { greeting, longDate } from "../lib/dates";
import { docHref } from "../lib/route";
import { useIndex } from "../state/store";

/** The same highlight all day, a different one tomorrow. */
function dailyPick<T>(list: T[], day: string): T | undefined {
  if (!list.length) return undefined;
  let h = 0;
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

type Fold = { closed: string[]; toggle: (id: string) => void };

/** A Home card whose heading folds it away; which ones are folded is kept per device. `count` shows beside a folded title. */
function HomeCard({ id, title, count, link, className, fold, children }: {
  id: string; title: ReactNode; count?: ReactNode; link?: ReactNode; className?: string; fold: Fold; children: ReactNode;
}) {
  const open = !fold.closed.includes(id);
  return (
    <section className={`card home-card${open ? "" : " folded"}${className ? " " + className : ""}`}>
      <div className="card-head">
        <h2>
          <button type="button" className="fold-btn" aria-expanded={open} onClick={() => fold.toggle(id)}>
            <IconChevronDown className="fold-chev" />
            <span className="fold-title">{title}</span>
            {count != null && <span className="muted"> · {count}</span>}
          </button>
        </h2>
        {link}
      </div>
      {open && children}
    </section>
  );
}

export function Home() {
  const ix = useIndex();
  const today = todayISO();
  const entry = ix.docs.get(journalPath(today));
  const [introDone, setIntroDone] = useLocalState("knowledgePath.introDone", false);
  const [closed, setClosed] = useLocalState<string[]>("knowledgePath.homeFolded", []);
  const fold: Fold = { closed, toggle: (id) => setClosed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])) };

  const resources = useMemo(() => [...ix.docs.values()].filter((d) => d.kind === "resource"), [ix]);
  const now = resources.filter((d) => d.resource!.status === "in-progress").sort((a, b) => b.mtime - a.mtime);
  const next = resources.filter((d) => d.resource!.status === "next").sort((a, b) => b.mtime - a.mtime);
  const recent = [...resources].filter((d) => d.resource!.status === "saved").sort((a, b) => (b.resource!.added ?? "").localeCompare(a.resource!.added ?? "") || b.mtime - a.mtime).slice(0, 4);
  const pinned = useMemo(() => pinnedDocs(ix), [ix]);
  const hl = useMemo(() => {
    const all: { d: Doc; quote: string; comment?: string }[] = [];
    for (const d of resources) for (const h of parseHighlights(d.body)) all.push({ d, quote: h.quote, comment: h.comment });
    return dailyPick(all, today);
  }, [resources, today]);
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

      {pinned.length > 0 && (
        <HomeCard id="pinned" fold={fold} count={pinned.length} title={<span className="pin-head"><IconPin width={18} height={18} /> Pinned</span>}>
          <ul className="item-list pinned-list">{pinned.map((d) => <DocRow key={d.path} d={d} ix={ix} showTopics={false} />)}</ul>
        </HomeCard>
      )}

      {habits.length > 0 ? (
        <HomeCard id="habits" fold={fold} title="Habits" count={due.length > 0 ? `${habitsDone} of ${due.length} today` : undefined} link={<a className="link" href="#habits">All</a>}>
          <ul className="item-list habit-list">{habits.map((d) => <HabitRow key={d.path} d={d} />)}</ul>
        </HomeCard>
      ) : allHabits.length === 0 && (
        <a className="card journal-card" href="#habits">
          <span className="journal-icon"><IconHabit /></span>
          <span className="grow"><b>Track a habit</b><span className="muted small">Something to do every day, or a few times a week.</span></span>
          <span className="chev">›</span>
        </a>
      )}

      {recipes.length > 0 ? (
        <HomeCard id="recipes" fold={fold} title="Recipes" count={againOld ? "cook again" : undefined} link={<a className="link" href="#recipes">All {recipes.length}</a>}>
          <ul className="item-list">{again.map((d) => <RecipeRow key={d.path} d={d} ix={ix} showTopics={false} />)}</ul>
          {toBuy > 0 && <a className="link small shop-link" href="#shopping"><IconCart width={16} height={16} /> Shopping list · {toBuy} to buy</a>}
        </HomeCard>
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

      {now.length > 0 && (
        <HomeCard id="now" fold={fold} title="In progress" count={now.length} link={<a className="link" href="#library">Library</a>}>
          <ul className="item-list">{now.slice(0, 5).map((d) => <ResourceRow key={d.path} d={d} ix={ix} />)}</ul>
        </HomeCard>
      )}

      {next.length > 0 && (
        <HomeCard id="next" fold={fold} title="Up next" count={next.length}>
          <ul className="item-list">{next.slice(0, 4).map((d) => <ResourceRow key={d.path} d={d} ix={ix} />)}</ul>
        </HomeCard>
      )}

      {hl && (
        <HomeCard id="highlight" fold={fold} className="hl-card" title={<span className="eyebrow"><IconQuote width={14} height={14} /> From your highlights</span>}>
          <blockquote dir="auto">{hl.quote}</blockquote>
          {hl.comment && <Markdown body={hl.comment} from={hl.d.path} className="muted small" />}
          <a className="link small" href={docHref(hl.d.path)} dir="auto">{hl.d.title}{hl.d.resource?.author ? `, ${hl.d.resource.author}` : ""}</a>
        </HomeCard>
      )}

      {recent.length > 0 && (
        <HomeCard id="recent" fold={fold} title="Recently saved" link={<a className="link" href="#library">All</a>}>
          <ul className="item-list">{recent.map((d) => <ResourceRow key={d.path} d={d} ix={ix} />)}</ul>
        </HomeCard>
      )}
    </>
  );
}
