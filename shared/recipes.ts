/* Recipes: one file per recipe in Recipes/, plain Markdown that Obsidian shows as it is.

     ---
     servings: 4            (or "12 cookies": the number is what scaling starts from)
     prep: 15 min
     cook: 25 min
     source: https://…      (where it came from; the enricher fills in the rest from it)
     image: https://…
     tags: [breakfast, vegetarian]
     topics: ["[[Cooking]]"]
     rating: 4
     ---
     Spicy. Less harissa for the kids.

     ## Ingredients

     - 2 tbsp olive oil
     - 1 onion, sliced
     ### For serving
     - parsley

     ## Steps

     1. Fry the onion for 10 minutes.
     2. Add the tomatoes; simmer 15 minutes.

     ## Notes

     ## Cooked

     - 2026-11-23: double batch, too salty
     - 2026-11-02

   Headings may be English or Hebrew (מצרכים, אופן ההכנה, הערות). An ingredient line is read as an amount,
   a unit and the rest ("1½ כוסות קמח", "2-3 cloves garlic"), so it can be scaled and converted; a line
   without an amount ("salt to taste") is shown as written. Used by the app and the enricher (no DOM or Node APIs). */
import { LOG_LINE } from "./habits.ts";
import { strList } from "./vault.ts";

// ── The frontmatter ───────────────────────────────────────────

export interface Recipe {
  /** What scaling starts from: the first number of `servings`. */
  servings?: number;
  /** `servings` as written when it isn't just a number ("12 cookies", "4-6"). */
  yield?: string;
  prep?: string;
  cook?: string;
  total?: string;
  source?: string;
  image?: string;
  site?: string;
  author?: string;
  rating?: number;
  enrich?: "pending" | "done" | "failed";
  enrichError?: string;
  /** Saved from a link and not yet named after the page. */
  provisional: boolean;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

export function recipeOf(fm: Record<string, unknown>): Recipe {
  const sv = str(fm.servings) ?? str(fm.yield) ?? str(fm.serves);
  const n = sv ? Number(/\d+(?:[.,]\d+)?/.exec(sv)?.[0]?.replace(",", ".")) : NaN;
  const rating = typeof fm.rating === "number" ? fm.rating : Number(str(fm.rating));
  return {
    servings: Number.isFinite(n) && n > 0 ? n : undefined,
    yield: sv && !/^\d+(?:[.,]\d+)?$/.test(sv) ? sv : undefined,
    prep: timeText(fm.prep), cook: timeText(fm.cook), total: timeText(fm.total),
    source: str(fm.source) ?? str(fm.url),
    image: str(fm.image),
    site: str(fm.site),
    author: str(fm.author),
    rating: Number.isFinite(rating) && rating > 0 ? Math.min(5, Math.round(rating)) : undefined,
    enrich: fm.enrich === "pending" || fm.enrich === "done" || fm.enrich === "failed" ? fm.enrich : undefined,
    enrichError: str(fm.enrichError),
    provisional: fm.provisional === true,
  };
}

/** A time from frontmatter as text: a bare number is minutes; ISO durations ("PT1H30M") become "1 h 30 min". */
export function timeText(v: unknown): string | undefined {
  if (typeof v === "number" && v > 0) return fmtMinutes(v);
  if (typeof v !== "string" || !v.trim()) return undefined;
  const s = v.trim();
  if (/^\d+(?:\.\d+)?$/.test(s)) return fmtMinutes(Number(s));
  const iso = isoMinutes(s);
  return iso != null ? (iso > 0 ? fmtMinutes(iso) : undefined) : s;
}

/** "PT1H30M" / "P0DT45M" → minutes; undefined if it isn't one. */
export function isoMinutes(s: string): number | undefined {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(s.trim());
  if (!m || s.trim().length < 3) return undefined;
  return Math.round((+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) + (+(m[4] ?? 0)) / 60);
}

export const fmtMinutes = (min: number) => {
  const m = Math.round(min);
  const h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h} h ${r} min` : h ? `${h} h` : `${r} min`;
};

/** Minutes in a time as written ("1 h 30 min", "90 min", "1:30", "שעה וחצי", "PT20M"); undefined if none. */
export function minutesOf(s?: string): number | undefined {
  if (!s) return undefined;
  const iso = isoMinutes(s);
  if (iso != null) return iso;
  const hm = /^(\d+):(\d{2})$/.exec(s.trim());
  if (hm) return +hm[1] * 60 + +hm[2];
  const found = findTimes(s);
  if (!found.length) return undefined;
  return Math.round(found.reduce((a, t) => a + t.seconds, 0) / 60);
}

/** The total time: `total`, else prep + cook. */
export function totalMinutes(r: Recipe): number | undefined {
  const t = minutesOf(r.total);
  if (t) return t;
  const p = minutesOf(r.prep) ?? 0, c = minutesOf(r.cook) ?? 0;
  return p + c || undefined;
}

// ── Sections ──────────────────────────────────────────────────

export type SectionKind = "ingredients" | "steps" | "notes" | "cooked" | "other";

const HEADS: [SectionKind, RegExp][] = [
  ["ingredients", /^(ingredients?|what you need|המצרכים|מצרכים|רכיבים|הרכיבים|חומרים|החומרים)$/i],
  ["steps", /^(steps|method|instructions|directions|preparation|how to make it|אופן ההכנה|אופן הכנה|הוראות הכנה|הוראות|הכנה|ההכנה|שלבי הכנה|שלבים)$/i],
  ["notes", /^(notes?|tips|הערות|הערה|טיפים)$/i],
  ["cooked", /^(cooked|made it|בישלתי)$/i],
];

/** The kind of a "## Heading" (or "# Heading"): cleaned of colons, bold and emoji. */
export function headKind(heading: string): SectionKind {
  const t = heading.replace(/[*_:]/g, "").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").trim();
  for (const [k, re] of HEADS) if (re.test(t)) return k;
  return "other";
}

const SECTION_HEAD = /^(#{1,2})\s+(.+?)\s*#*\s*$/;

export interface Section { kind: SectionKind | "intro"; title?: string; head: number; start: number; end: number }

/** The body's sections: the intro (before any heading), then each "##" section. Lines [start, end). */
export function sections(lines: string[]): Section[] {
  const out: Section[] = [];
  let cur: Section = { kind: "intro", head: -1, start: 0, end: lines.length };
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^(```|~~~)/.test(lines[i])) fence = !fence;
    const m = fence ? null : SECTION_HEAD.exec(lines[i]);
    if (!m) continue;
    const kind = headKind(m[2]);
    if (m[1] === "#" && kind === "other") continue; // a "# Title" at the top is the recipe's name, not a section
    cur.end = i;
    out.push(cur);
    cur = { kind, title: m[2], head: i, start: i + 1, end: lines.length };
  }
  out.push(cur);
  return out;
}

// ── Amounts ───────────────────────────────────────────────────

export type UnitId = "tsp" | "tbsp" | "cup" | "ml" | "l" | "g" | "kg" | "oz" | "floz" | "lb" | "pint" | "quart" | "stick" | "pinch";

/** Unit spellings, longest first when matched. Hebrew too (כוס, כפות, גרם, מ״ל…). */
const UNIT_WORDS: [UnitId, string[]][] = [
  ["tsp", ["teaspoons", "teaspoon", "tsps", "tsp", "כפיות", "כפית"]],
  ["tbsp", ["tablespoons", "tablespoon", "tbsps", "tbsp", "tbs", "tbl", "כפות", "כף"]],
  ["cup", ["cups", "cup", "כוסות", "כוס"]],
  ["floz", ["fluid ounces", "fluid ounce", "fl. oz", "fl oz", "fl.oz"]],
  ["ml", ["milliliters", "millilitres", "milliliter", "millilitre", "ml", "מ\"ל", "מ״ל", "מ'ל", "מל"]],
  ["l", ["liters", "litres", "liter", "litre", "l", "ליטרים", "ליטר"]],
  ["kg", ["kilograms", "kilogram", "kilos", "kilo", "kg", "ק\"ג", "ק״ג", "קילוגרם", "קילו"]],
  ["g", ["grams", "gram", "grammes", "gramme", "gr", "g", "גרם", "גר'", "גר׳", "ג'", "ג׳"]],
  ["oz", ["ounces", "ounce", "oz"]],
  ["lb", ["pounds", "pound", "lbs", "lb"]],
  ["pint", ["pints", "pint", "pt"]],
  ["quart", ["quarts", "quart", "qt"]],
  ["stick", ["sticks", "stick"]],
  ["pinch", ["pinches", "pinch", "קורט", "קמצוץ"]],
];
const UNIT_LIST = UNIT_WORDS.flatMap(([id, ws]) => ws.map((w) => [w, id] as [string, UnitId])).sort((a, b) => b[0].length - a[0].length);
const HEB = /[֐-׿]/;
export const isHebrew = (s: string) => HEB.test(s);

const FRAC: Record<string, number> = { "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4, "⅕": 1 / 5, "⅖": 2 / 5, "⅗": 3 / 5, "⅘": 4 / 5, "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8 };
const FC = "[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]";
const NUM_RE = new RegExp(
  `^(?:(\\d+)\\s*(${FC})|(\\d+)[\\s-]+(\\d+)\\s*[/⁄]\\s*(\\d+)|(\\d+)\\s*[/⁄]\\s*(\\d+)|(${FC})|(\\d*[.,]\\d+|\\d+))`,
);
const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, quarter: 0.25, dozen: 12,
  אחת: 1, אחד: 1, שתי: 2, שני: 2, שתיים: 2, שניים: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6,
  שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10, חצי: 0.5, רבע: 0.25, שליש: 1 / 3,
};

/** A number at the start of `s`: "2", "1.5", "1,5", "½", "1½", "1 1/2", "1-1/2", "3/4", "two", "חצי". */
export function readNumber(s: string): { n: number; len: number } | null {
  const m = NUM_RE.exec(s);
  if (m) {
    let n: number;
    if (m[1] != null) n = +m[1] + FRAC[m[2]];
    else if (m[3] != null) n = +m[3] + +m[4] / +m[5];
    else if (m[6] != null) n = +m[6] / +m[7];
    else if (m[8] != null) n = FRAC[m[8]];
    else n = Number(m[9].replace(",", "."));
    if (!Number.isFinite(n)) return null;
    // "1,000" is a thousand, not one point zero
    if (m[9] && /^\d+,\d{3}/.test(s)) { const t = /^\d{1,3}(?:,\d{3})+/.exec(s)![0]; return { n: Number(t.replace(/,/g, "")), len: t.length }; }
    return { n, len: m[0].length };
  }
  const w = /^([\p{L}]+)(?=\s|$)/u.exec(s);
  if (w && WORD_NUM[w[1].toLowerCase()] != null) return { n: WORD_NUM[w[1].toLowerCase()], len: w[1].length };
  return null;
}

/** A unit at the start of `s` (no letter may follow it). */
function readUnit(s: string): { unit: UnitId; len: number } | null {
  const lower = s.toLowerCase();
  for (const [w, id] of UNIT_LIST) {
    if (!lower.startsWith(w)) continue;
    // "T" (capital) is a tablespoon; a lone "t" or "c" is too ambiguous
    const next = s.slice(w.length);
    if (/^[\p{L}\p{N}]/u.test(next)) continue;
    let len = w.length;
    if (next.startsWith(".") && /^[a-z]/i.test(w)) len++;
    return { unit: id, len };
  }
  if (/^T(?![\p{L}])/u.test(s)) return { unit: "tbsp", len: 1 };
  return null;
}

export interface Qty { n: number; to?: number }

export interface Ingredient {
  /** the line as written, without the list marker */
  text: string;
  /** "about ", "כ-" */
  pre: string;
  qty?: Qty;
  unit?: UnitId;
  /** where the amount (and unit) ends in `text` */
  amountEnd: number;
  /** everything after the amount: "onion, sliced" */
  rest: string;
  /** the ingredient itself, for matching: lowercase, no parentheses, no ", sliced" */
  name: string;
}

const HALF_AFTER = /^\s*(?:ו(?:עוד\s+)?חצי|and\s+(?:a\s+)?half|and\s+1\/2)(?![\p{L}])/iu;

/** Read an ingredient line: amount, unit and the rest. */
export function parseIngredient(line: string): Ingredient {
  const text = line.trim();
  let i = 0;
  const pre = /^(?:(?:about|approx\.?|approximately|roughly|around|scant|heaping|כ|בערך)\s+|כ[-־]?(?=\d))/i.exec(text)?.[0] ?? "";
  i += pre.length;
  let qty: Qty | undefined;
  let unit: UnitId | undefined;
  const num = readNumber(text.slice(i));
  let afterNum = i;
  if (num) {
    qty = { n: num.n };
    afterNum = i + num.len;
    // a range: "2-3", "2 to 3", "2 עד 3"
    const r = /^\s*(?:-|–|—|to|or|עד|או)\s*/i.exec(text.slice(afterNum));
    if (r) {
      const b = readNumber(text.slice(afterNum + r[0].length));
      if (b && b.n > num.n) { qty.to = b.n; afterNum += r[0].length + b.len; }
    }
    const half = HALF_AFTER.exec(text.slice(afterNum));
    if (half) { qty.n += 0.5; if (qty.to) qty.to += 0.5; afterNum += half[0].length; }
  }
  // "half a cup", "a cup of", "כוס קמח" (no number: one)
  let j = afterNum;
  const filler = /^\s*(?:an?|of)\s+/i.exec(text.slice(j));
  const tryUnit = (at: number) => readUnit(text.slice(at).replace(/^\s+/, ""));
  const lead = (at: number) => text.slice(at).length - text.slice(at).replace(/^\s+/, "").length;
  let u = tryUnit(j);
  if (!u && filler && (qty || /^\s*an?\s/i.test(text.slice(j)))) {
    const at = j + filler[0].length;
    const u2 = tryUnit(at);
    if (u2) { j = at; u = u2; }
  }
  // the unit comes before a number only with a filler ("a cup") or on its own in Hebrew ("כוס קמח")
  if (u && (qty || j > afterNum || isHebrew(text.slice(j, j + lead(j) + u.len)))) {
    unit = u.unit;
    j += lead(j) + u.len;
    qty ??= { n: 1 };
    const half = HALF_AFTER.exec(text.slice(j));
    if (half) { qty.n += 0.5; if (qty.to) qty.to += 0.5; j += half[0].length; }
  } else j = afterNum;
  const amountEnd = qty ? j : 0;
  const rest = qty ? text.slice(amountEnd).replace(/^\s+/, "") : text;
  return { text, pre: qty ? pre : "", qty, unit, amountEnd, rest, name: ingredientName(rest) };
}

/** "of all-purpose flour (sifted), divided" → "all-purpose flour" */
export function ingredientName(rest: string): string {
  return rest.toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/^\s*(?:of|של)\s+/, "")
    .replace(/[,;].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── The body ──────────────────────────────────────────────────

export interface Group<T> { title?: string; items: T[] }
export interface IngredientLine extends Ingredient { line: number }
export interface StepLine { text: string; line: number }
export interface Cooked { date: string; note?: string; line: number }

export interface ParsedRecipe {
  intro: string;
  ingredients: Group<IngredientLine>[];
  steps: Group<StepLine>[];
  /** the Notes section and any other section (with its heading), as Markdown */
  notes: string;
  /** newest first */
  cooked: Cooked[];
}

const LIST_ITEM = /^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|(\d+)[.)]\s+)(.*)$/;
const GROUP_HEAD = /^#{3,6}\s+(.+?)\s*#*\s*$/;
/** "For the sauce:" or "**For the sauce**" on a line of its own */
const groupLine = (t: string) => {
  const b = /^\*\*(.+?)\*\*:?$/.exec(t) ?? /^__(.+?)__:?$/.exec(t);
  if (b) return b[1].trim();
  return t.length <= 60 && /:$/.test(t) && !readNumber(t) ? t.slice(0, -1).trim() : undefined;
};

function readIngredients(lines: string[], s: Section, groups: Group<IngredientLine>[]) {
  let g: Group<IngredientLine> = groups[groups.length - 1] ?? { items: [] };
  if (!groups.length) groups.push(g);
  for (let i = s.start; i < s.end; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;
    const head = GROUP_HEAD.exec(t);
    const li = LIST_ITEM.exec(raw);
    const title = head ? head[1] : !li ? groupLine(t) : undefined;
    if (title != null) { g = { title, items: [] }; groups.push(g); continue; }
    const text = li ? li[3] : t;
    if (!text.trim()) continue;
    g.items.push({ ...parseIngredient(text), line: i });
  }
}

function readSteps(lines: string[], s: Section, groups: Group<StepLine>[]) {
  let g: Group<StepLine> = groups[groups.length - 1] ?? { items: [] };
  if (!groups.length) groups.push(g);
  let open = false; // can the next line continue the last step?
  for (let i = s.start; i < s.end; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) { open = false; continue; }
    const head = GROUP_HEAD.exec(t);
    if (head) { g = { title: head[1], items: [] }; groups.push(g); open = false; continue; }
    const li = LIST_ITEM.exec(raw);
    const last = g.items[g.items.length - 1];
    if (li && li[1].length === 0) {
      if (li[3].trim()) { g.items.push({ text: li[3].trim(), line: i }); open = true; } // "1. " alone is the empty template
      continue;
    }
    // an indented line or a nested bullet belongs to the step above
    if (last && (open || /^\s{2,}|^\t/.test(raw))) { last.text += (li ? "\n" : " ") + (li ? li[3] : t).trim(); continue; }
    const gt = !li ? groupLine(t) : undefined;
    if (gt != null && t.length < 50) { g = { title: gt, items: [] }; groups.push(g); continue; }
    g.items.push({ text: li ? li[3].trim() : t, line: i });
    open = false;
  }
}

export function parseRecipe(body: string): ParsedRecipe {
  const lines = body.split("\n");
  const secs = sections(lines);
  const ingredients: Group<IngredientLine>[] = [];
  const steps: Group<StepLine>[] = [];
  const notes: string[] = [];
  const cooked: Cooked[] = [];
  let intro = "";
  for (const s of secs) {
    const content = lines.slice(s.start, s.end).join("\n").trim();
    if (s.kind === "intro") intro = content.replace(/^#\s+.*\n?/, "").trim();
    else if (s.kind === "ingredients") readIngredients(lines, s, ingredients);
    else if (s.kind === "steps") readSteps(lines, s, steps);
    else if (s.kind === "cooked") {
      for (let i = s.start; i < s.end; i++) {
        const m = LOG_LINE.exec(lines[i]);
        if (m && !cooked.some((c) => c.date === m[1])) cooked.push({ date: m[1], note: m[2]?.trim() || undefined, line: i });
      }
    } else if (s.kind === "notes") { if (content) notes.push(content); }
    else if (content || s.title) notes.push(`## ${s.title}\n\n${content}`.trim());
  }
  const clean = <T>(gs: Group<T>[]) => gs.filter((g) => g.items.length || g.title);
  cooked.sort((a, b) => b.date.localeCompare(a.date));
  return { intro, ingredients: clean(ingredients), steps: clean(steps), notes: notes.join("\n\n"), cooked };
}

export const allIngredients = (p: ParsedRecipe) => p.ingredients.flatMap((g) => g.items);

/** The ingredients to buy: a group with the same ingredients as an earlier one is another way to make it
    ("### Unsoaked" / "### Soaked", the same beans with different water), so only the first of them counts. */
export function ingredientsToBuy(p: ParsedRecipe): IngredientLine[] {
  const seen = new Set<string>();
  return p.ingredients.flatMap((g) => {
    const key = [...new Set(g.items.map((x) => x.name || x.text.toLowerCase()).filter(Boolean))].sort().join("\n");
    if (!key) return g.items;
    if (seen.has(key)) return [];
    seen.add(key);
    return g.items;
  });
}
export const allSteps = (p: ParsedRecipe) => p.steps.flatMap((g) => g.items);

// ── Writing a recipe ──────────────────────────────────────────

export interface RecipeParts {
  intro?: string;
  /** one per line; "### For the sauce" starts a group */
  ingredients: string[];
  /** one per step; "### Assembly" starts a group */
  steps: string[];
  notes?: string;
}

const groupMark = (s: string) => /^#{3,6}\s+/.test(s);

export function ingredientsMd(items: string[]): string {
  return items.map((x) => x.trim()).filter(Boolean).map((x) => (groupMark(x) ? `\n${x}` : `- ${x}`)).join("\n").trim();
}

export function stepsMd(items: string[]): string {
  let n = 0;
  return items.map((x) => x.trim()).filter(Boolean).map((x) => {
    if (groupMark(x)) { n = 0; return `\n${x}\n`; }
    return `${++n}. ${x.replace(/\n+/g, " ")}`;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A new recipe's body. With no ingredients or steps, an empty item in each to start typing in. */
export function recipeBody(p: Partial<RecipeParts> = {}): string {
  const ing = ingredientsMd(p.ingredients ?? []) || "- ";
  const st = stepsMd(p.steps ?? []) || "1. ";
  return [
    p.intro?.trim(),
    `## Ingredients\n\n${ing}`,
    `## Steps\n\n${st}`,
    p.notes?.trim() ? `## Notes\n\n${p.notes.trim()}` : undefined,
  ].filter(Boolean).join("\n\n") + "\n";
}

/** Fill in a recipe found elsewhere (an import), without overwriting anything already written:
    only when the body has no ingredients and no steps yet. Notes, the Cooked log and other sections stay. */
export function fillRecipe(body: string, p: RecipeParts): string {
  const cur = parseRecipe(body);
  if (allIngredients(cur).some((x) => x.text) || allSteps(cur).some((x) => x.text)) return body;
  const lines = body.split("\n");
  const keep = sections(lines).filter((s) => s.kind !== "intro" && s.kind !== "ingredients" && s.kind !== "steps")
    .map((s) => lines.slice(s.head, s.end).join("\n").trim()).filter(Boolean);
  const intro = cur.intro || p.intro?.trim();
  return [recipeBody({ intro, ingredients: p.ingredients, steps: p.steps }).trim(), ...keep].join("\n\n") + "\n";
}

// ── The Cooked log ────────────────────────────────────────────

/** Add a day to the Cooked log (replacing that day's line), newest first; the section is made if missing. */
export function setCooked(body: string, date: string, note?: string | null): string {
  const lines = body.split("\n");
  const sec = sections(lines).find((s) => s.kind === "cooked");
  const line = `- ${date}${note?.trim() ? `: ${note.trim().replace(/\s*\n\s*/g, " ")}` : ""}`;
  if (!sec) {
    if (note === null) return body;
    const t = body.replace(/\s+$/, "");
    return `${t ? t + "\n\n" : ""}## Cooked\n\n${line}\n`;
  }
  const entries: { i: number; date: string }[] = [];
  for (let i = sec.start; i < sec.end; i++) { const m = LOG_LINE.exec(lines[i]); if (m) entries.push({ i, date: m[1] }); }
  const same = entries.filter((e) => e.date === date);
  if (note === null) {
    for (const e of [...same].reverse()) lines.splice(e.i, 1);
    return lines.join("\n");
  }
  if (same.length) {
    lines[same[0].i] = line;
    for (const e of same.slice(1).reverse()) lines.splice(e.i, 1);
    return lines.join("\n");
  }
  const older = entries.find((e) => e.date < date);
  if (older) lines.splice(older.i, 0, line);
  else if (entries.length) lines.splice(entries[entries.length - 1].i + 1, 0, line);
  else {
    // right under the heading, one blank line between
    let at = sec.start;
    while (at < sec.end && !lines[at].trim()) at++;
    const tail = at < lines.length && lines[at].trim() ? [""] : [];
    lines.splice(sec.start, at - sec.start, "", line, ...tail);
  }
  const out = lines.join("\n");
  return out.endsWith("\n") ? out : out + "\n";
}

// ── Scaling ───────────────────────────────────────────────────

const GLYPH: [number, string][] = [[1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"]];

/** A cook's number: fractions (1½, ⅓) for spoons, cups and counts. */
export function fmtFraction(n: number): string {
  if (n <= 0) return "0";
  let whole = Math.floor(n);
  let frac = n - whole;
  const options: [number, string][] = whole >= 5 ? [[0, ""], [1 / 2, "½"], [1, ""]] : [[0, ""], ...GLYPH, [1, ""]];
  let best = options[0];
  for (const o of options) if (Math.abs(frac - o[0]) < Math.abs(frac - best[0])) best = o;
  if (best[0] === 1) { whole++; frac = 0; return String(whole); }
  if (!whole && !best[1]) return "⅛"; // a pinch is still something
  return `${whole || ""}${best[1]}`;
}

/** Grams and millilitres: whole numbers, coarser as they grow (8, 35, 120, 450, 1250). */
export function fmtMetric(n: number): string {
  if (n < 1) return String(Math.round(n * 10) / 10 || 0.1);
  if (n < 10) return String(Math.round(n * 2) / 2);
  if (n < 50) return String(Math.round(n));
  if (n < 1000) return String(Math.round(n / 5) * 5);
  return String(Math.round(n / 10) * 10);
}

const fmtDecimal = (n: number) => String(Math.round(n * 100) / 100);

export function fmtNumber(n: number, unit?: UnitId): string {
  if (unit === "g" || unit === "ml") return fmtMetric(n);
  if (unit === "kg" || unit === "l") return fmtDecimal(n);
  return fmtFraction(n);
}

const EN_UNIT: Record<UnitId, [string, string]> = {
  tsp: ["tsp", "tsp"], tbsp: ["tbsp", "tbsp"], cup: ["cup", "cups"], ml: ["ml", "ml"], l: ["l", "l"], g: ["g", "g"], kg: ["kg", "kg"],
  oz: ["oz", "oz"], floz: ["fl oz", "fl oz"], lb: ["lb", "lb"], pint: ["pint", "pints"], quart: ["quart", "quarts"], stick: ["stick", "sticks"], pinch: ["pinch", "pinches"],
};
const HE_UNIT: Partial<Record<UnitId, [string, string]>> = {
  tsp: ["כפית", "כפיות"], tbsp: ["כף", "כפות"], cup: ["כוס", "כוסות"], ml: ["מ״ל", "מ״ל"], l: ["ליטר", "ליטר"], g: ["גרם", "גרם"], kg: ["ק״ג", "ק״ג"], pinch: ["קורט", "קורט"],
};

export function unitLabel(unit: UnitId, n: number, hebrew: boolean): string {
  const [one, many] = (hebrew ? HE_UNIT[unit] : undefined) ?? EN_UNIT[unit];
  return n > 1 ? many : one;
}

/** An amount as text: "1½ cups", "2–3", "400 g". */
export function amountText(q: Qty, unit: UnitId | undefined, hebrew: boolean): string {
  const num = q.to != null ? `${fmtNumber(q.n, unit)}–${fmtNumber(q.to, unit)}` : fmtNumber(q.n, unit);
  return unit ? `${num} ${unitLabel(unit, q.to ?? q.n, hebrew)}` : num;
}

export const scaleQty = (q: Qty, f: number): Qty => ({ n: q.n * f, to: q.to != null ? q.to * f : undefined });

export interface Shown {
  /** the amount to show in bold, or undefined when the line has none */
  amount?: string;
  rest: string;
  /** the amount was changed: scaled or converted */
  changed: boolean;
  /** when converted to metric: the amount as written (at this scale) */
  original?: string;
}

/** An ingredient line as shown at a scale (1 = as written), in metric units if asked: cups, ounces and pounds
    become grams (millilitres for liquids, and for what we don't know the weight of); spoons stay spoons. */
export function showIngredient(ing: Ingredient, factor: number, metric = false): Shown {
  if (!ing.qty) return { rest: metric ? convertText(ing.text) : ing.text, changed: false };
  const rest = metric ? convertText(ing.rest) : ing.rest;
  const he = isHebrew(ing.text);
  const conv = metric ? toMetric(ing.qty, ing.unit, ing.name) : null;
  if (conv) {
    const q = scaleQty(conv.qty, factor);
    // "1 cup (2 sticks) butter": the parenthesis only restates the amount, which is shown as written at the end
    const bare = ing.rest.replace(/^\((?=[^()]*\d)[^()]*\b(?:sticks?|cups?|oz|ounces?|g|grams?|tbsp|tablespoons?|ml|lbs?)\b[^()]*\)\s*/i, "");
    return { amount: ing.pre + amountText(q, conv.unit, he), rest: bare === ing.rest ? rest : convertText(bare), changed: true, original: amountText(scaleQty(ing.qty, factor), ing.unit, he) };
  }
  if (Math.abs(factor - 1) < 1e-9) return { amount: ing.text.slice(0, ing.amountEnd).trim(), rest, changed: false };
  return { amount: ing.pre + amountText(scaleQty(ing.qty, factor), ing.unit, he), rest, changed: true };
}

// ── Metric ────────────────────────────────────────────────────

/** Millilitres in each volume unit (a cup is 240 ml, as in Israel and on US nutrition labels). */
const ML: Partial<Record<UnitId, number>> = { tsp: 5, tbsp: 15, cup: 240, floz: 29.57, pint: 473, quart: 946, ml: 1, l: 1000 };
const GRAMS: Partial<Record<UnitId, number>> = { oz: 28.35, lb: 453.6, g: 1, kg: 1000 };

/** Grams in a cup (240 ml) of common ingredients; `true` marks a liquid (shown in ml). The longest name that
    matches wins, so "brown sugar" beats "sugar" and "peanut butter" beats "butter". */
const PER_CUP: [string, number, true?][] = [
  ["all-purpose flour", 125], ["plain flour", 125], ["bread flour", 130], ["whole wheat flour", 120], ["wholemeal flour", 120], ["almond flour", 96], ["almond meal", 96], ["cake flour", 115], ["self-raising flour", 125], ["self-rising flour", 125], ["flour", 125],
  ["semolina", 167], ["cornmeal", 150], ["polenta", 160], ["cornstarch", 128], ["cornflour", 128], ["potato starch", 160],
  ["powdered sugar", 120], ["icing sugar", 120], ["confectioners", 120], ["brown sugar", 213], ["caster sugar", 200], ["sugar", 200],
  ["honey", 340], ["maple syrup", 315], ["golden syrup", 340], ["date syrup", 340], ["molasses", 337], ["syrup", 330],
  ["cocoa", 85], ["rolled oats", 90], ["oats", 90], ["rice", 190], ["quinoa", 170], ["couscous", 180], ["bulgur", 160], ["lentils", 190], ["split peas", 200], ["dried chickpeas", 200],
  ["breadcrumbs", 110], ["bread crumbs", 110], ["panko", 60], ["chocolate chips", 170], ["chopped chocolate", 170], ["raisins", 150], ["dried cranberries", 120],
  ["walnuts", 115], ["pecans", 110], ["almonds", 140], ["hazelnuts", 135], ["pistachios", 125], ["cashews", 130], ["peanuts", 145], ["pine nuts", 135], ["nuts", 130], ["sesame seeds", 145], ["sunflower seeds", 140], ["seeds", 140],
  ["shredded coconut", 85], ["desiccated coconut", 85], ["coconut flakes", 60],
  ["parmesan", 100], ["grated cheese", 100], ["shredded cheese", 113], ["cream cheese", 230], ["ricotta", 245], ["cottage cheese", 225], ["feta", 150], ["cheese", 113],
  ["sour cream", 230], ["greek yogurt", 285], ["yogurt", 245], ["yoghurt", 245], ["labneh", 260],
  ["peanut butter", 258], ["butter", 227], ["margarine", 227], ["tahini", 240], ["mayonnaise", 220], ["ketchup", 240], ["tomato paste", 260], ["jam", 320], ["nutella", 300],
  ["kosher salt", 145], ["sea salt", 270], ["salt", 290], ["baking soda", 230], ["bicarbonate", 230], ["baking powder", 192], ["yeast", 150],
  ["fresh herbs", 30], ["parsley", 30], ["cilantro", 30], ["basil", 25], ["spinach", 30], ["chopped onion", 160], ["diced onion", 160], ["frozen peas", 145], ["blueberries", 150], ["berries", 150], ["corn kernels", 165],
  ["oil", 218], ["olive oil", 216], ["melted butter", 227],
  ["coconut milk", 240, true], ["coconut cream", 240, true], ["buttermilk", 245, true], ["heavy cream", 240, true], ["whipping cream", 240, true], ["cream", 240, true], ["milk", 245, true], ["water", 240, true],
  ["juice", 250, true], ["stock", 240, true], ["broth", 240, true], ["wine", 240, true], ["vinegar", 240, true], ["coffee", 240, true], ["soy sauce", 255, true], ["sauce", 250, true],
  // Hebrew
  ["קמח מלא", 120], ["קמח לחם", 130], ["קמח שקדים", 96], ["קמח תופח", 125], ["קמח", 125], ["סולת", 167], ["קורנפלור", 128], ["קמח תירס", 150],
  ["אבקת סוכר", 120], ["סוכר חום", 213], ["סוכר", 200], ["דבש", 340], ["סילאן", 340], ["סירופ מייפל", 315], ["סירופ", 330],
  ["קקאו", 85], ["שיבולת שועל", 90], ["אורז", 190], ["קינואה", 170], ["קוסקוס", 180], ["בורגול", 160], ["עדשים", 190], ["פירורי לחם", 110], ["פנקו", 60],
  ["שוקולד צ'יפס", 170], ["שוקולד קצוץ", 170], ["צימוקים", 150], ["אגוזי מלך", 115], ["פקאן", 110], ["שקדים", 140], ["אגוזי לוז", 135], ["פיסטוקים", 125], ["קשיו", 130], ["בוטנים", 145], ["צנובר", 135], ["אגוזים", 130], ["שומשום", 145], ["גרעינים", 140],
  ["קוקוס", 85], ["פרמזן", 100], ["גבינה מגוררת", 100], ["גבינת שמנת", 230], ["ריקוטה", 245], ["קוטג'", 225], ["פטה", 150], ["גבינה", 113],
  ["שמנת חמוצה", 230], ["יוגורט יווני", 285], ["יוגורט", 245], ["לבנה", 260],
  ["חמאת בוטנים", 258], ["חמאה", 227], ["מרגרינה", 227], ["טחינה", 240], ["מיונז", 220], ["קטשופ", 240], ["רסק עגבניות", 260], ["ריבה", 320],
  ["מלח גס", 145], ["מלח", 290], ["סודה לשתייה", 230], ["אבקת אפייה", 192], ["שמרים", 150], ["פטרוזיליה", 30], ["כוסברה", 30], ["אוכמניות", 150],
  ["שמן זית", 216], ["שמן", 218],
  ["חלב קוקוס", 240, true], ["שמנת מתוקה", 240, true], ["שמנת לבישול", 240, true], ["שמנת", 240, true], ["רוויון", 245, true], ["חלב", 245, true], ["מים", 240, true],
  ["מיץ", 250, true], ["ציר", 240, true], ["יין", 240, true], ["חומץ", 240, true], ["קפה", 240, true], ["רוטב סויה", 255, true],
];
const PER_CUP_SORTED = [...PER_CUP].sort((a, b) => b[0].length - a[0].length);
const matches = (n: string, w: string) => (/^[a-z' -]+$/.test(w) ? new RegExp(`(^|[^a-z])${w}`).test(n) : n.includes(w));

/** Grams per cup of an ingredient (and whether it's a liquid), or undefined when we don't know it. */
export function perCup(name: string): { g: number; liquid: boolean } | undefined {
  const n = name.toLowerCase();
  const hit = PER_CUP_SORTED.find(([w]) => matches(n, w));
  return hit ? { g: hit[1], liquid: !!hit[2] } : undefined;
}

/** An amount in grams or millilitres (kilos and litres from 1000), or null when it's metric already or spoons. */
export function toMetric(q: Qty, unit: UnitId | undefined, name: string): { qty: Qty; unit: UnitId } | null {
  if (!unit || unit === "tsp" || unit === "tbsp" || unit === "pinch" || unit === "g" || unit === "ml" || unit === "kg" || unit === "l") return null;
  let per: number; // grams or ml per one of `unit`
  let out: UnitId;
  if (unit === "stick") { per = 113; out = "g"; } // a stick of butter
  else if (GRAMS[unit]) { per = GRAMS[unit]!; out = "g"; }
  else {
    const ml = ML[unit]!;
    const d = perCup(name);
    if (d && !d.liquid) { per = (ml / 240) * d.g; out = "g"; } else { per = ml; out = "ml"; }
  }
  let qty = scaleQty(q, per);
  if (qty.n >= 1000) { qty = scaleQty(qty, 1 / 1000); out = out === "g" ? "kg" : "l"; }
  return { qty, unit: out };
}

const round5 = (n: number) => Math.round(n / 5) * 5;
const num = (s: string) => Number(s.replace(",", "."));

/** Temperatures, pan sizes and ounces inside text, in metric: "350°F" → "175°C", "9x13-inch" → "23×33 cm", "(14 oz)" → "(400 g)". */
export function convertText(text: string): string {
  return text
    .replace(/(\d{2,3})\s*(?:°|º|degrees?)\s*(?:F|Fahrenheit)\b|(\d{3})\s*F\b/g, (_m, a: string, b: string) => `${round5(((+(a ?? b)) - 32) * 5 / 9)}°C`)
    .replace(/(\d+(?:[.,]\d+)?)(?:\s*(?:x|×|by)\s*(\d+(?:[.,]\d+)?))?(?:\s*-\s*|\s+)?(?:inch(?:es)?\b|in\.(?=\s|$|[,)])|(?<=\d)["”])/g,
      (_m, a: string, b?: string) => `${Math.round(num(a) * 2.54)}${b ? `×${Math.round(num(b) * 2.54)}` : ""} cm`)
    .replace(/(\d+(?:[.,]\d+)?)\s*-?\s*(fl\.?\s*oz|fluid ounces?|oz|ounces?)\b/gi, (_m, a: string, u: string) =>
      /^f/i.test(u) ? `${fmtMetric(num(a) * 29.57)} ml` : `${fmtMetric(num(a) * 28.35)} g`)
    .replace(/(\d+(?:[.,]\d+)?)\s*-?\s*(?:lbs?|pounds?)\b/gi, (_m, a: string) => { const g = num(a) * 453.6; return g >= 1000 ? `${fmtDecimal(g / 1000)} kg` : `${fmtMetric(g)} g`; });
}

// ── Times in steps ────────────────────────────────────────────

export interface FoundTime { index: number; length: number; seconds: number; label: string }

const TIME_UNIT: [RegExp, number][] = [
  [/^(?:hours?|hrs?|h|שעות|שעה)$/i, 3600],
  [/^(?:minutes?|mins?|דקות|דקה|דק'|דק׳)$/i, 60],
  [/^(?:seconds?|secs?|שניות|שנייה|שניה)$/i, 1],
];
const unitSeconds = (u: string) => TIME_UNIT.find(([re]) => re.test(u))?.[1];
const TIME_RE = new RegExp(
  "(?<![\\p{L}\\d])(?:" +
    // "10 minutes", "6–8 min", "1½ hours", "1 1/2 hours", "an hour", "half an hour", "20 דקות"
    `(\\d+(?:[.,]\\d+)?\\s*${FC}?|\\d+\\s+\\d\\/\\d|${FC}|an?|one|half an?)(?:\\s*(?:-|–|—|to|עד)\\s*(\\d+(?:[.,]\\d+)?))?\\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?|שעות|שעה|דקות|דקה|דק'|דק׳|שניות|שנייה|שניה|h(?=\\b))` +
    "|(שעתיים|חצי שעה|רבע שעה|שעה וחצי|כשעה|שעה)" +
  ")(?![\\p{L}])",
  "giu",
);
const HEB_TIME: Record<string, [number, string]> = {
  "שעתיים": [7200, "2 h"], "חצי שעה": [1800, "30 min"], "רבע שעה": [900, "15 min"], "שעה וחצי": [5400, "1 h 30 min"], "כשעה": [3600, "1 h"], "שעה": [3600, "1 h"],
};

const timeLabel = (sec: number) => (sec < 60 ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : fmtMinutes(sec / 60));

/** Durations in a step, for its timers. A range ("6–8 minutes") starts the timer at its low end. */
export function findTimes(text: string): FoundTime[] {
  const out: FoundTime[] = [];
  for (const m of text.matchAll(TIME_RE)) {
    let seconds: number;
    let label: string;
    if (m[4]) {
      const [s, l] = HEB_TIME[m[4]];
      seconds = s; label = l;
    } else {
      const unit = unitSeconds(m[3]);
      if (!unit) continue;
      const a = m[1].trim().toLowerCase();
      const n = a === "a" || a === "an" || a === "one" ? 1 : a.startsWith("half") ? 0.5 : readNumber(a.replace(/\s+/g, " "))?.n;
      if (!n) continue;
      seconds = Math.round(n * unit);
      const to = m[2] ? Number(m[2].replace(",", ".")) : undefined;
      label = to && to > n ? `${timeLabel(seconds)}–${timeLabel(Math.round(to * unit))}`.replace(/ (min|h|s)–/, "–") : timeLabel(seconds);
    }
    if (seconds > 0 && seconds <= 72 * 3600) out.push({ index: m.index!, length: m[0].length, seconds, label });
  }
  return out;
}

// ── Lists ─────────────────────────────────────────────────────

/** What the recipe list needs to filter and sort. */
export interface RecipeSummary {
  ingredients: string[];
  cooked: string[];
  minutes?: number;
}

export function summarize(r: Recipe, body: string): RecipeSummary {
  const p = parseRecipe(body);
  return { ingredients: allIngredients(p).map((x) => x.name).filter(Boolean), cooked: p.cooked.map((c) => c.date), minutes: totalMinutes(r) };
}

/** Tags written in the frontmatter (for the filter chips). */
export const recipeTags = (fm: Record<string, unknown>) => strList(fm.tags).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean);

// ── Pasted text ───────────────────────────────────────────────

const BULLET = /^\s*(?:[-*+•·▪▢□☐◦‣⁃]\s*|\[[ xX]\]\s*|-\s*\[[ xX]\]\s*)/;
const NUMBERED = /^\s*(?:step\s*|שלב\s*)?\d{1,2}\s*[.):\-–]\s*/i;
const stripBullet = (s: string) => s.replace(BULLET, "").trim();

/** A heading on a line of its own in pasted text ("Ingredients", "**Method:**", "## אופן ההכנה"), or null. */
function pastedHead(line: string): "ingredients" | "steps" | "notes" | null {
  const t = line.trim().replace(/^#+\s*/, "").replace(/^(\*\*|__)(.*)\1$/, "$2").replace(/[:：]$/, "").trim();
  if (!t || t.length > 40) return null;
  const k = headKind(t);
  return k === "ingredients" || k === "steps" || k === "notes" ? k : null;
}

/** A group heading inside a list ("### For the sauce", "For the sauce:"), or undefined. */
const pastedGroup = (t: string) => /^#{1,6}\s+(.+)$/.exec(t)?.[1].trim() ?? (BULLET.test(t) ? undefined : groupLine(t));

/** Steps from pasted lines: numbered lines start a step and the lines after continue it; without numbers, one line is one step. */
function pastedSteps(lines: string[]): string[] {
  const out: string[] = [];
  const numbered = lines.some((l) => NUMBERED.test(l));
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    const g = !NUMBERED.test(t) ? pastedGroup(t) : undefined;
    if (g != null && t.length < 50) { out.push(`### ${g}`); continue; }
    if (numbered && !NUMBERED.test(t) && out.length && !out[out.length - 1].startsWith("### ")) { out[out.length - 1] += " " + stripBullet(t); continue; }
    out.push(stripBullet(t.replace(NUMBERED, "")));
  }
  return out.filter(Boolean);
}

/** A recipe pasted as text (from a message, a book, Notes): its title, intro, ingredients and steps.
    With headings ("Ingredients", "מצרכים", "Method", "אופן ההכנה") they decide; without, a line that starts
    with an amount is an ingredient and what comes after the ingredients is the steps. */
export function parseRecipeText(text: string): RecipeParts & { title?: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  const pre: string[] = [], ing: string[] = [], stepLines: string[] = [], notes: string[] = [];
  let mode: "pre" | "ingredients" | "steps" | "notes" = "pre";
  let headed = false;
  for (const l of lines) {
    const h = pastedHead(l);
    if (h) { mode = h; headed = true; continue; }
    if (mode === "pre") pre.push(l);
    else if (mode === "ingredients") {
      const t = l.trim();
      if (!t) continue;
      const g = pastedGroup(t);
      ing.push(g != null ? `### ${g}` : stripBullet(t));
    } else if (mode === "steps") stepLines.push(l);
    else notes.push(l);
  }
  let intro = pre;
  if (!headed) {
    // no headings: amounts mark the ingredients, and the steps follow them
    intro = [];
    let phase: "pre" | "ingredients" | "steps" = "pre";
    for (const l of pre) {
      const t = l.trim();
      const isIng = !!t && t.length <= 90 && !!parseIngredient(stripBullet(t)).qty && !/[.!?]$/.test(t);
      if (phase !== "steps" && isIng) { phase = "ingredients"; ing.push(stripBullet(t)); continue; }
      if (phase === "ingredients" && t && BULLET.test(l) && !NUMBERED.test(t)) { ing.push(stripBullet(t)); continue; }
      if (phase === "ingredients" && t) phase = "steps";
      if (phase === "steps") stepLines.push(l);
      else intro.push(l);
    }
  }
  const firstIdx = intro.findIndex((l) => l.trim());
  let title: string | undefined;
  if (firstIdx >= 0) {
    const t = intro[firstIdx].trim().replace(/^#+\s*/, "");
    if (t.length <= 80 && !/[.!?]$/.test(t)) { title = t; intro = intro.slice(firstIdx + 1); }
  }
  return {
    title,
    intro: intro.join("\n").replace(/\n{3,}/g, "\n\n").trim() || undefined,
    ingredients: ing.filter((x) => x && x !== "### "),
    steps: pastedSteps(stepLines),
    notes: notes.join("\n").trim() || undefined,
  };
}
