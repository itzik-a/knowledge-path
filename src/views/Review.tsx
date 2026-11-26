/* #review: flashcards from highlights (shared/cards.ts, src/state/cards.ts). The cards due now, one at a
   time: the front (a cloze with its words hidden, or where it's from and my comment), Show, then how well I
   remembered (Again / Hard / Good / Easy, FSRS picks when it comes back). Below, every card by source. */
import { useEffect, useMemo, useState } from "react";
import { clozeParts, isCloze, isNew, reviewQueue, type Card } from "../../shared/cards.ts";
import { plainLinks } from "../../shared/books.ts";
import { IconCards } from "../components/Icons";
import { docHref } from "../lib/route";
import { preview, Rating, spanText, type Grade } from "../lib/srs";
import { showToast } from "../lib/toast";
import { gradeCard, setCard, useCards } from "../state/cards";
import { medDate } from "../lib/dates";

const GRADES: { g: Grade; label: string; key: string }[] = [
  { g: Rating.Again, label: "Again", key: "1" },
  { g: Rating.Hard, label: "Hard", key: "2" },
  { g: Rating.Good, label: "Good", key: "3" },
  { g: Rating.Easy, label: "Easy", key: "4" },
];

/** Cards to review now (for the sidebar badge and Home). */
export function useDueCount(): number {
  const cards = useCards();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  return useMemo(() => reviewQueue(cards, now).length, [cards, now]);
}

export function Review() {
  const cards = useCards();
  const [now, setNow] = useState(Date.now);
  // early: also what comes back within the next half hour (cards still being learnt)
  const [ahead, setAhead] = useState(false);
  const queue = useMemo(() => reviewQueue(cards, now + (ahead ? 30 * 60_000 : 0)), [cards, now, ahead]);
  const [done, setDone] = useState(0);
  const card = queue[0];
  const soon = useMemo(() => cards.filter((c) => c.rec.srs && c.rec.srs.due > now && c.rec.srs.due <= now + 30 * 60_000).length, [cards, now]);
  // a card being learnt comes back within minutes: look again every 20 s
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(t); }, []);

  const answer = (c: Card, g: Grade) => {
    const { due, undo } = gradeCard(c, g);
    setDone((x) => x + 1);
    setNow(Date.now());
    showToast(`${GRADES.find((x) => x.g === g)!.label}: back in ${spanText(due - Date.now())}`, { label: "Undo", run: () => { undo(); setDone((x) => Math.max(0, x - 1)); } });
  };

  return (
    <>
      <div className="page-head row-head">
        <div>
          <span className="eyebrow">From your highlights</span>
          <h1 className="display">Flashcards</h1>
        </div>
      </div>

      {card ? (
        <FlashCard key={`${card.key}-${card.rec.at}`} card={card} left={queue.length} done={done} onAnswer={(g) => answer(card, g)} />
      ) : (
        <section className="card review-done">
          {cards.length ? (
            <>
              <h2>{done ? "Done for now" : "Nothing to review now"}</h2>
              <p className="muted">
                {soon ? `${soon === 1 ? "A card you're learning comes" : `${soon} cards you're learning come`} back within half an hour.` : nextText(cards, now)}
              </p>
              {soon > 0 && <button type="button" className="btn sm" onClick={() => setAhead(true)}>Review {soon === 1 ? "it" : "them"} now</button>}
            </>
          ) : (
            <>
              <h2>No flashcards yet</h2>
              <p className="muted">Any highlight can be a card: press <IconCards width={16} height={16} className="inline-icon" /> beside it on its page. Mark words in it with <code>==…==</code> and the card hides them for you to recall; without marks, you recall the passage from where it's from and your comment.</p>
            </>
          )}
        </section>
      )}

      {cards.length > 0 && <AllCards cards={cards} now={now} />}
    </>
  );
}

function nextText(cards: Card[], now: number) {
  const next = cards.filter((c) => c.rec.srs && c.rec.srs.due > now).sort((a, b) => a.rec.srs!.due - b.rec.srs!.due)[0];
  return next ? `The next one is due in ${spanText(next.rec.srs!.due - now)}.` : "";
}

function FlashCard({ card, left, done, onAnswer }: { card: Card; left: number; done: number; onAnswer: (g: Grade) => void }) {
  const [shown, setShown] = useState(false);
  const cloze = isCloze(card.h.quote);
  const times = useMemo(() => preview(card.rec.srs), [card]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!shown && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setShown(true); return; }
      const g = shown ? GRADES.find((x) => x.key === e.key) : undefined;
      if (g) { e.preventDefault(); onAnswer(g.g); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [shown, onAnswer]);

  const words = card.h.quote.replace(/==/g, "").split(/\s+/);
  const cue = words.slice(0, 4).join(" ") + (words.length > 4 ? " …" : "");
  return (
    <section className="card flashcard" aria-live="polite">
      <div className="card-head">
        <span className="eyebrow">{isNew(card) ? "New" : "Review"} · {left} left{done ? ` · ${done} done` : ""}</span>
        <a className="link small clamp1" href={docHref(card.path)} dir="auto">{card.title}</a>
      </div>
      {cloze ? (
        <blockquote className="fc-quote" dir="auto">
          {clozeParts(card.h.quote).map((p, i) => p.hidden
            ? (shown ? <mark key={i}>{p.text}</mark> : <span key={i} className="cloze-blank" aria-label="hidden words">{" ".repeat(Math.min(6, Math.max(2, Math.ceil(p.text.length / 4))))}</span>)
            : <span key={i}>{p.text}</span>)}
        </blockquote>
      ) : shown ? (
        <blockquote className="fc-quote" dir="auto">{card.h.quote}</blockquote>
      ) : (
        <div className="fc-front">
          <p className="muted small">Recall the passage that starts</p>
          <p className="fc-cue" dir="auto">{cue}</p>
        </div>
      )}
      {card.h.comment && <p className="muted small" dir="auto">{plainLinks(card.h.comment)}</p>}
      {!shown ? (
        <button type="button" className="btn primary fc-show" onClick={() => setShown(true)}>Show <kbd className="fc-kbd">Space</kbd></button>
      ) : (
        <div className="fc-grades" role="group" aria-label="How well did you remember it?">
          {GRADES.map(({ g, label, key }) => (
            <button key={g} type="button" className={`btn fc-grade g${g}`} onClick={() => onAnswer(g)}>
              <span>{label}</span>
              <span className="fc-when">{spanText(times[g])}</span>
              <kbd className="fc-kbd">{key}</kbd>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Every card, by the file it's in, with when it's due; a card can be taken out. */
function AllCards({ cards, now }: { cards: Card[]; now: number }) {
  const groups = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of cards) m.set(c.path, [...(m.get(c.path) ?? []), c]);
    return [...m.entries()].sort((a, b) => a[1][0].title.localeCompare(b[1][0].title));
  }, [cards]);
  return (
    <section className="card">
      <h2>All cards <span className="muted">· {cards.length}</span></h2>
      {groups.map(([path, cs]) => (
        <div key={path} className="fc-group">
          <a className="fc-group-head" href={docHref(path)} dir="auto">{cs[0].title}</a>
          <ul className="fc-list">
            {cs.map((c) => (
              <li key={c.key}>
                <span className="grow clamp2" dir="auto">{c.h.quote.replace(/==/g, "")}</span>
                <span className="muted small fc-due">{dueText(c, now)}</span>
                <button type="button" className="icon-btn subtle on" aria-label="Stop being a flashcard" title="Stop being a flashcard" onClick={() => setCard(c.path, c.h.quote, false)}><IconCards /></button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function dueText(c: Card, now: number) {
  if (!c.rec.srs || c.rec.srs.state === 0) return "New";
  const d = c.rec.srs.due - now;
  if (d <= 0) return "Due";
  return d < 7 * 86_400_000 ? `In ${spanText(d)}` : medDate(new Date(c.rec.srs.due).toISOString().slice(0, 10));
}
