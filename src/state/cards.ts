/* Flashcards (shared/cards.ts): which highlights are cards, and their schedules, in .hub/cards.json. */
import { useMemo } from "react";
import { cardKey, CARDS_PATH, collectCards, parseCards, writeCards, type Card, type CardMap } from "../../shared/cards.ts";
import { todayISO } from "../../shared/vault.ts";
import { review, type Grade } from "../lib/srs";
import { showToast } from "../lib/toast";
import { getIndex, readFile, useIndex, writeFile } from "./store";

export const readCards = (): CardMap => parseCards(readFile(CARDS_PATH));
const save = (m: CardMap) => writeFile(CARDS_PATH, writeCards(m));

/** Every card whose highlight is still there. Re-renders when the vault changes. */
export function useCards(): Card[] {
  const ix = useIndex();
  const raw = readFile(CARDS_PATH);
  return useMemo(() => collectCards(ix, parseCards(raw)).cards, [ix, raw]);
}

/** Is this highlight a card? */
export const isCard = (quote: string, m: CardMap = readCards()) => cardKey(quote) in m;

/** Make a highlight a card, or stop it being one (its schedule goes too), with Undo. */
export function setCard(path: string, quote: string, on: boolean) {
  const before = readCards();
  const k = cardKey(quote);
  if (on === k in before) return;
  const next = { ...before };
  if (on) next[k] = { src: path, added: todayISO(), at: Date.now() };
  else delete next[k];
  save(next);
  showToast(on ? "Made a flashcard" : "No longer a flashcard", { label: "Undo", run: () => save(before) });
}

/** Answer a card: when it comes back, and how to take the answer back. */
export function gradeCard(card: Card, grade: Grade): { due: number; undo: () => void } {
  const before = readCards();
  const rec = before[card.key];
  if (!rec) return { due: 0, undo: () => {} };
  const now = Date.now();
  const srs = review(rec.srs, grade, now);
  save({ ...before, [card.key]: { ...rec, src: card.path, at: now, srs } });
  return { due: srs.due, undo: () => { const cur = readCards(); save({ ...cur, [card.key]: rec }); } };
}

/** A highlight's text changed: its card follows (the schedule kept). */
export function moveCard(path: string, from: string, to: string | null) {
  const m = readCards();
  const a = cardKey(from);
  if (!(a in m)) return;
  const next = { ...m };
  const rec = next[a];
  delete next[a];
  if (to != null) next[cardKey(to)] = { ...rec, src: path, at: Date.now() };
  save(next);
}

/** Cards whose highlight is gone from every file (removed elsewhere, or in Obsidian). */
export function forgetLostCards() {
  const m = readCards();
  const { lost } = collectCards(getIndex(), m);
  if (!lost.length) return;
  const next = { ...m };
  for (const k of lost) delete next[k];
  save(next);
}
