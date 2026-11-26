/* FSRS scheduling (ts-fsrs, FSRS-6) over the cards' plain-number state (shared/cards.ts), as in Language Path. */
import { createEmptyCard, fsrs, Rating, type Card as FCard, type FSRS, type Grade } from "ts-fsrs";
import type { Srs } from "../../shared/cards.ts";

export { Rating };
export type { Grade };

/** How likely I should be to remember a card when it comes back. */
export const RETENTION = 0.9;

let f: FSRS | null = null;
const scheduler = () => (f ??= fsrs({ request_retention: RETENTION, enable_fuzz: true, enable_short_term: true, maximum_interval: 3650 }));

const toF = (s: Srs): FCard => ({
  due: new Date(s.due), stability: s.stability, difficulty: s.difficulty, elapsed_days: s.elapsed_days, scheduled_days: s.scheduled_days,
  learning_steps: s.learning_steps, reps: s.reps, lapses: s.lapses, state: s.state, ...(s.last_review ? { last_review: new Date(s.last_review) } : {}),
});
const fromF = (c: FCard): Srs => ({
  due: c.due.getTime(), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsed_days, scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps, reps: c.reps, lapses: c.lapses, state: c.state as Srs["state"], ...(c.last_review ? { last_review: c.last_review.getTime() } : {}),
});

export const newSrs = (now = Date.now()): Srs => fromF(createEmptyCard(new Date(now)));

/** The card after answering with `grade` (a new card starts from scratch). */
export function review(s: Srs | undefined, grade: Grade, now = Date.now()): Srs {
  return fromF(scheduler().next(toF(s ?? newSrs(now)), new Date(now), grade).card);
}

/** When each answer would bring the card back (ms from now). */
export function preview(s: Srs | undefined, now = Date.now()): Record<Grade, number> {
  const p = scheduler().repeat(toF(s ?? newSrs(now)), new Date(now));
  return {
    [Rating.Again]: p[Rating.Again].card.due.getTime() - now,
    [Rating.Hard]: p[Rating.Hard].card.due.getTime() - now,
    [Rating.Good]: p[Rating.Good].card.due.getTime() - now,
    [Rating.Easy]: p[Rating.Easy].card.due.getTime() - now,
  } as Record<Grade, number>;
}

/** "10 min", "3 d", "2 mo" */
export function spanText(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} d`;
  const mo = Math.round(d / 30.4);
  if (mo < 12) return `${mo} mo`;
  return `${Math.round((d / 365) * 10) / 10} y`;
}
