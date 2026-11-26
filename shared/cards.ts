/* Flashcards from highlights (DOM- and Node-free). A highlight becomes a card when I ask for it; the cards
   and their schedules (FSRS) are app data, `.hub/cards.json`, so notes stay plain Markdown:

     {
       "cards": {
         "k1x9…": {"src":"Resources/Meditations.md","added":"2026-11-26","at":1764170000000,"srs":{…}},
         …
       }
     }

   one card a line. A card's key is a hash of its highlight's text (without ==cloze== marks, spaces folded),
   so marking words for a cloze or moving the file keeps it; `src` is where it was last seen. Two devices'
   copies merge card by card (`mergeCards`, used by the sync): the one changed last wins.

   In the card, words marked ==like this== are hidden (a cloze); a highlight without marks is a recall card:
   where it's from and my comment on the front, the passage on the back. */
import { parseHighlights, type Highlight } from "./vault.ts";
import type { Index } from "./index.ts";

export const CARDS_PATH = ".hub/cards.json";

/** FSRS state (ts-fsrs's Card, dates as epoch ms). */
export interface Srs {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  /** 0 new, 1 learning, 2 review, 3 relearning */
  state: 0 | 1 | 2 | 3;
  last_review?: number;
}

export interface CardRec {
  /** the file its highlight was last seen in */
  src: string;
  /** the day it was made a card */
  added: string;
  /** last change (ms): the newer copy wins a merge */
  at: number;
  /** missing until its first review */
  srs?: Srs;
}

export type CardMap = Record<string, CardRec>;

/** cyrb53: a quick 53-bit string hash. */
function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A highlight's card key: its text without cloze marks, spaces folded. */
export const cardKey = (quote: string) => hash(quote.replace(/==/g, "").replace(/\s+/g, " ").trim());

export function parseCards(text: string | undefined): CardMap {
  if (!text) return {};
  try {
    const j = JSON.parse(text) as { cards?: unknown };
    const c = j.cards;
    if (!c || typeof c !== "object" || Array.isArray(c)) return {};
    const out: CardMap = {};
    for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const r = v as Partial<CardRec>;
      if (typeof r.src !== "string") continue;
      out[k] = { src: r.src, added: typeof r.added === "string" ? r.added : "", at: typeof r.at === "number" ? r.at : 0, ...(r.srs && typeof r.srs === "object" ? { srs: r.srs as Srs } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

/** One card a line, keys sorted, so the file diffs and reads well. */
export function writeCards(cards: CardMap): string {
  const keys = Object.keys(cards).sort();
  if (!keys.length) return `{\n  "cards": {}\n}\n`;
  return `{\n  "cards": {\n${keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(cards[k])}`).join(",\n")}\n  }\n}\n`;
}

const same = (a?: CardRec, b?: CardRec) => JSON.stringify(a) === JSON.stringify(b);

/** Three-way merge of two devices' cards: per card, a change on one side wins over no change; changed on both,
    the newer one (`at`); an edit wins over a removal. */
export function mergeCards(base: string, mine: string, theirs: string): string {
  const b = parseCards(base), m = parseCards(mine), t = parseCards(theirs);
  const out: CardMap = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)])) {
    const bk = b[k], mk = m[k], tk = t[k];
    let v: CardRec | undefined;
    if (same(mk, bk)) v = tk;
    else if (same(tk, bk)) v = mk;
    else if (!mk || !tk) v = mk ?? tk;
    else v = mk.at >= tk.at ? mk : tk;
    if (v) out[k] = v;
  }
  return writeCards(out);
}

export const isCardsPath = (path: string) => path === CARDS_PATH;

/** A piece of a card's text; `hidden`: a cloze to recall. */
export interface Part { text: string; hidden?: boolean }

/** The highlight's text split at ==cloze== marks. */
export function clozeParts(quote: string): Part[] {
  const out: Part[] = [];
  const re = /==([^=\n](?:[^=]|=(?!=))*?)==/g;
  let last = 0;
  for (const m of quote.matchAll(re)) {
    if (m.index! > last) out.push({ text: quote.slice(last, m.index) });
    out.push({ text: m[1], hidden: true });
    last = m.index! + m[0].length;
  }
  if (last < quote.length) out.push({ text: quote.slice(last) });
  return out;
}

export const isCloze = (quote: string) => clozeParts(quote).some((p) => p.hidden);

export interface Card {
  key: string;
  rec: CardRec;
  /** the file it's in now, its title and the highlight */
  path: string;
  title: string;
  h: Highlight;
}

/** Every highlight in the vault by card key (the first one, for the same text twice). */
export function highlightsByKey(ix: Index): Map<string, { path: string; h: Highlight }> {
  const out = new Map<string, { path: string; h: Highlight }>();
  for (const d of ix.docs.values()) {
    if (d.kind === "hub" || !/^##\s+highlights\s*$/im.test(d.body)) continue;
    for (const h of parseHighlights(d.body)) {
      const k = cardKey(h.quote);
      if (!out.has(k)) out.set(k, { path: d.path, h });
    }
  }
  return out;
}

/** The cards whose highlights still exist (in `src`, or anywhere if it moved), and the keys of those that don't. */
export function collectCards(ix: Index, recs: CardMap): { cards: Card[]; lost: string[] } {
  const byKey = highlightsByKey(ix);
  const cards: Card[] = [];
  const lost: string[] = [];
  for (const [key, rec] of Object.entries(recs)) {
    const at = byKey.get(key);
    if (!at) { lost.push(key); continue; }
    cards.push({ key, rec, path: at.path, title: ix.docs.get(at.path)?.title ?? at.path, h: at.h });
  }
  return { cards, lost };
}

export const isNew = (c: Pick<Card, "rec">) => !c.rec.srs || c.rec.srs.state === 0;
export const isDue = (c: Pick<Card, "rec">, now: number) => !c.rec.srs || c.rec.srs.due <= now;

/** What to review now: cards due (the most overdue first), then new ones (oldest first), at most `newLimit` new. */
export function reviewQueue(cards: Card[], now: number, newLimit = Infinity): Card[] {
  const due = cards.filter((c) => !isNew(c) && isDue(c, now)).sort((a, b) => a.rec.srs!.due - b.rec.srs!.due);
  const fresh = cards.filter((c) => isNew(c) && isDue(c, now)).sort((a, b) => a.rec.added.localeCompare(b.rec.added) || a.rec.at - b.rec.at).slice(0, newLimit);
  return [...due, ...fresh];
}
