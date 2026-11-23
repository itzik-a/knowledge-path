/* The shopping list: one note, `Shopping list.md` at the top of the vault, a checklist grouped by aisle,
   so it reads (and ticks off) the same in Obsidian:

     ## Produce
     - [ ] 2 onions ([[Shakshuka]])
     - [x] parsley
     ## Dairy & eggs
     - [ ] 6 eggs ([[Shakshuka]], [[Pancakes]])

   Adding an ingredient that's already on the list unticked, in the same unit, adds the amounts up.
   No DOM or Node APIs. */
import { amountText, isHebrew, parseIngredient, type Qty, type UnitId } from "./recipes.ts";

export const SHOPPING_PATH = "Shopping list.md";

export const AISLES = ["Produce", "Dairy & eggs", "Meat & fish", "Bakery", "Pantry", "Spices", "Frozen", "Drinks", "Other"] as const;
export type Aisle = (typeof AISLES)[number];

/** Words that place an ingredient in an aisle, English and Hebrew; the first aisle that matches wins (spices before produce, so "garlic powder" is a spice). */
const AISLE_WORDS: [Aisle, string[]][] = [
  ["Spices", ["powder", "paprika", "cumin", "turmeric", "cinnamon", "oregano", "thyme dried", "dried", "chili flakes", "pepper flakes", "black pepper", "peppercorn", "nutmeg", "cardamom", "coriander seed", "seeds", "bay lea", "spice", "za'atar", "zaatar", "sumac", "baharat", "vanilla", "salt",
    "תבלין", "פפריקה", "כמון", "כורכום", "קינמון", "אורגנו", "פלפל שחור", "אגוז מוסקט", "זרעי", "עלי דפנה", "זעתר", "סומק", "בהרט", "וניל", "מלח", "אבקת"]],
  ["Dairy & eggs", ["egg", "milk", "butter", "cream", "cheese", "yogurt", "yoghurt", "labneh", "feta", "parmesan", "mozzarella", "ricotta", "buttermilk", "bulgarit", "tofu",
    "ביצ", "חלב", "חמאה", "שמנת", "גבינ", "יוגורט", "לבנה", "פטה", "פרמזן", "מוצרלה", "ריקוטה", "קוטג", "בולגרית", "טופו"]],
  ["Meat & fish", ["chicken", "beef", "lamb", "pork", "turkey", "mince", "steak", "sausage", "bacon", "fish", "salmon", "tuna", "shrimp", "prawn", "cod",
    "עוף", "חזה", "פרגית", "בקר", "טחון", "כבש", "הודו", "נקניק", "דג", "סלמון", "טונה", "שרימפס", "בשר"]],
  ["Bakery", ["bread", "pita", "baguette", "tortilla", "bun", "roll", "brioche", "challah", "לחם", "פיתה", "פיתות", "באגט", "טורטיה", "לחמני", "חלה"]],
  ["Frozen", ["frozen", "ice cream", "קפוא", "קפואה", "גלידה"]],
  ["Drinks", ["wine", "beer", "soda water", "יין", "בירה"]],
  ["Produce", ["onion", "garlic", "tomato", "potato", "carrot", "pepper", "chilli", "chili", "lemon", "lime", "orange", "apple", "banana", "berr", "blueberr", "strawberr", "raspberr", "blackberr", "cranberr", "lettuce", "spinach", "cabbage", "cucumber", "zucchini", "courgette", "eggplant", "aubergine", "mushroom", "celery", "leek", "ginger", "avocado", "herb", "parsley", "cilantro", "coriander", "basil", "mint", "dill", "thyme", "rosemary", "scallion", "spring onion", "shallot", "squash", "pumpkin", "corn", "broccoli", "cauliflower", "kale", "chard", "mangold", "beet", "greens", "arugula", "rocket", "radish", "sweet potato", "pineapple", "mango", "peach", "plum", "pear", "grape", "melon", "watermelon", "kiwi", "pomegranate", "fruit", "vegetable",
    "בצל", "שום", "עגבני", "תפוח", "גזר", "פלפל", "צ'ילי", "לימון", "ליים", "תפוז", "בננה", "חסה", "תרד", "כרוב", "מלפפון", "קישוא", "חציל", "פטריות", "סלרי", "כרישה", "מנגולד", "סלק", "עלים ירוקים", "רוקט", "צנון", "בטטה", "אננס", "מנגו", "אפרסק", "שזיף", "אגס", "ענבים", "מלון", "אבטיח", "קיווי", "רימון", "ג'ינג'ר", "אבוקדו", "פטרוזיליה", "כוסברה", "בזיליקום", "נענע", "שמיר", "טימין", "רוזמרין", "בצל ירוק", "דלעת", "תירס", "ברוקולי", "כרובית", "ירק"]],
  ["Pantry", ["flour", "sugar", "rice", "pasta", "noodle", "oil", "vinegar", "honey", "syrup", "tahini", "sauce", "stock", "broth", "can", "tin", "beans", "lentil", "chickpea", "oat", "nut", "peanut", "pistachio", "cashew", "hazelnut", "pecan", "almond", "walnut", "chocolate", "cocoa", "yeast", "baking", "cornstarch", "breadcrumb", "couscous", "bulgur", "quinoa", "jam", "mustard", "ketchup", "mayo", "paste", "coconut", "raisin", "date",
    "קמח", "סוכר", "אורז", "פסטה", "אטריות", "שמן", "חומץ", "דבש", "סילאן", "סירופ", "טחינה", "רוטב", "ציר", "קופסת", "שעועית", "עדשים", "חומוס", "שיבולת", "אגוז", "שקד", "שוקולד", "קקאו", "שמרים", "קורנפלור", "פירורי", "קוסקוס", "בורגול", "קינואה", "ריבה", "חרדל", "קטשופ", "מיונז", "רסק", "קוקוס", "צימוק", "תמר"]],
];

/** Names a keyword above would misfile ("eggplant" isn't an egg, baking powder isn't a spice). */
const EXCEPT: [string, Aisle][] = [
  ["eggplant", "Produce"], ["aubergine", "Produce"], ["peanut butter", "Pantry"], ["coconut milk", "Pantry"], ["coconut cream", "Pantry"],
  ["baking powder", "Pantry"], ["baking soda", "Pantry"], ["cocoa", "Pantry"], ["sugar", "Pantry"], ["chocolate", "Pantry"], ["cornstarch", "Pantry"], ["cornflour", "Pantry"],
  ["rolled oats", "Pantry"], ["tomato paste", "Pantry"], ["canned", "Pantry"], ["crushed tomato", "Pantry"], ["cans", "Pantry"], ["can of", "Pantry"], ["passata", "Pantry"],
  ["עגבניות מרוסקות", "Pantry"], ["קופסת", "Pantry"], ["קופסאות", "Pantry"], ["garlic powder", "Spices"], ["onion powder", "Spices"],
  ["collagen", "Pantry"], ["protein powder", "Pantry"], ["pumpkin seeds", "Pantry"], ["sunflower seeds", "Pantry"], ["sesame seeds", "Pantry"], ["chia", "Pantry"], ["flax", "Pantry"],
  ["קולגן", "Pantry"], ["אבקת חלבון", "Pantry"], ["גרעיני דלעת", "Pantry"], ["שומשום", "Pantry"], ["צ'יה", "Pantry"],
  ["חלב קוקוס", "Pantry"], ["שמנת קוקוס", "Pantry"], ["אבקת אפייה", "Pantry"], ["אבקת סוכר", "Pantry"], ["סודה לשתייה", "Pantry"], ["רסק עגבניות", "Pantry"], ["חמאת בוטנים", "Pantry"],
];

/** An English keyword matches at the start of a word ("egg" in "eggs", not in "nutmeg"); a Hebrew one anywhere (ה, ו, ב are glued on). */
const has = (n: string, w: string) => (/^[a-z' ]+$/.test(w) ? new RegExp(`(^|[^a-z])${w.replace(/'/g, "'")}`).test(n) : n.includes(w));

export function aisleOf(name: string): Aisle {
  const n = name.toLowerCase();
  for (const [w, a] of EXCEPT) if (has(n, w)) return a;
  for (const [a, words] of AISLE_WORDS) if (words.some((w) => has(n, w))) return a;
  return "Other";
}

export interface ShopItem {
  line: number;
  done: boolean;
  /** what to buy, without the recipe links */
  text: string;
  /** the recipes it's for */
  recipes: string[];
  aisle: string;
}

const ITEM = /^[-*+] \[([ xX])\] (.*)$/;
const FOR = /\s*\(((?:\[\[[^\]\n]+\]\](?:,\s*)?)+)\)\s*$/;
const AISLE_HEAD = /^##\s+(.+?)\s*$/;

function splitItem(raw: string): { text: string; recipes: string[] } {
  const m = FOR.exec(raw);
  if (!m) return { text: raw.trim(), recipes: [] };
  return { text: raw.slice(0, m.index).trim(), recipes: [...m[1].matchAll(/\[\[([^\]|\n]+)(?:\|[^\]]*)?\]\]/g)].map((x) => x[1].trim()) };
}

const itemLine = (done: boolean, text: string, recipes: string[]) =>
  `- [${done ? "x" : " "}] ${text}${recipes.length ? ` (${recipes.map((r) => `[[${r}]]`).join(", ")})` : ""}`;

export function parseShopping(body: string): ShopItem[] {
  const out: ShopItem[] = [];
  let aisle = "Other";
  body.split("\n").forEach((l, line) => {
    const h = AISLE_HEAD.exec(l);
    if (h) { aisle = h[1]; return; }
    const m = ITEM.exec(l);
    if (m) out.push({ line, done: m[1] !== " ", ...splitItem(m[2]), aisle });
  });
  return out;
}

/** "onions" and "onion" are the same thing to buy. */
const keyOf = (rest: string) => rest.toLowerCase().replace(/\([^)]*\)/g, "").replace(/,.*$/, "").replace(/\s+/g, " ").trim().replace(/(?<=[a-z]{3})(es|s)$/, "");

export interface NewItem {
  text: string;
  /** the recipe it's for (its title), if any */
  recipe?: string;
}

/** Add items under their aisles (the aisle heading is made in its place if missing); an unticked item with the
    same name and unit gets the amounts added up. */
export function addItems(body: string, items: NewItem[]): string {
  const lines = body.replace(/\s+$/, "").split("\n").filter((l, i, a) => l.trim() || i < a.length - 1);
  if (lines.length === 1 && !lines[0].trim()) lines.length = 0;
  for (const it of items) {
    const text = it.text.trim();
    if (!text) continue;
    const ing = parseIngredient(text);
    const key = keyOf(ing.rest);
    // the same thing, unticked, in the same unit: add up
    let merged = false;
    for (let i = 0; i < lines.length && key; i++) {
      const m = ITEM.exec(lines[i]);
      if (!m || m[1] !== " ") continue;
      const cur = splitItem(m[2]);
      const ci = parseIngredient(cur.text);
      if (keyOf(ci.rest) !== key) continue;
      const recipes = it.recipe && !cur.recipes.includes(it.recipe) ? [...cur.recipes, it.recipe] : cur.recipes;
      if (ci.qty && ing.qty && ci.unit === ing.unit && ci.qty.to == null && ing.qty.to == null) {
        const sum: Qty = { n: ci.qty.n + ing.qty.n };
        const rest = ing.qty.n > ci.qty.n ? ing.rest : ci.rest; // "3 onions", not "3 onion"
        lines[i] = itemLine(false, `${amountText(sum, ci.unit as UnitId | undefined, isHebrew(cur.text))} ${rest}`.trim(), recipes);
        merged = true;
      } else if (!ci.qty && !ing.qty) {
        lines[i] = itemLine(false, cur.text, recipes);
        merged = true;
      }
      if (merged) break;
    }
    if (merged) continue;
    const aisle = aisleOf(ing.name || text);
    const line = itemLine(false, text, it.recipe ? [it.recipe] : []);
    let h = lines.findIndex((l) => AISLE_HEAD.exec(l)?.[1] === aisle);
    if (h < 0) {
      // a new aisle heading, before the first aisle that comes after it in the usual order
      const order = AISLES.indexOf(aisle);
      let at = lines.length;
      for (let i = 0; i < lines.length; i++) {
        const name = AISLE_HEAD.exec(lines[i])?.[1];
        if (name && AISLES.indexOf(name as Aisle) > order) { at = i; break; }
      }
      const block = [`## ${aisle}`, line];
      if (at > 0 && lines[at - 1].trim()) block.unshift("");
      if (at < lines.length) block.push("");
      lines.splice(at, 0, ...block);
      continue;
    }
    // at the end of the aisle's items
    let end = h + 1;
    while (end < lines.length && !AISLE_HEAD.test(lines[end])) end++;
    while (end > h + 1 && !lines[end - 1].trim()) end--;
    lines.splice(end, 0, line);
  }
  return lines.join("\n") + "\n";
}

/** Remove the ticked items, and any aisle left empty. */
export function clearDone(body: string): string {
  const lines = body.split("\n").filter((l) => { const m = ITEM.exec(l); return !m || m[1] === " "; });
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (AISLE_HEAD.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !AISLE_HEAD.test(lines[j]) && !lines[j].trim()) j++;
      if (j >= lines.length || AISLE_HEAD.test(lines[j])) { i = j - 1; continue; } // empty aisle
    }
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\s*$/, "\n");
}
