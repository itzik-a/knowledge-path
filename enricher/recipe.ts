/* A recipe from a web page: most recipe sites describe their recipe as schema.org Recipe data (JSON-LD, for
   search engines), so ingredients and steps can be read exactly as written, with no Claude. */
import { timeText, type RecipeParts } from "../shared/recipes.ts";
import { decodeEntities, isHttpUrl, stripHtml } from "./net.ts";

export interface Imported extends RecipeParts {
  title?: string;
  servings?: string | number;
  prep?: string;
  cook?: string;
  total?: string;
  image?: string;
  author?: string;
  tags: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isRecipe = (o: Obj) => {
  const t = o["@type"];
  return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
};

/** Some sites write JSON-LD with raw line breaks inside strings, or a trailing comma: forgive those. */
function parseLoose(s: string): unknown {
  try { return JSON.parse(s); } catch { /* try again, tidied */ }
  // escape control characters inside strings (a line break there is a line break in the text)
  let out = "", inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr && c === "\\") { out += c + (s[i + 1] ?? ""); i++; continue; }
    if (c === '"') inStr = !inStr;
    out += inStr && c === "\n" ? "\\n" : inStr && (c === "\r" || c === "\t") ? " " : c;
  }
  try { return JSON.parse(out.replace(/,\s*([}\]])/g, "$1")); } catch { return undefined; }
}

/** The first Recipe in a page's JSON-LD blocks (inside @graph, arrays and mainEntity too). */
export function findRecipeLd(blocks: string[]): Obj | undefined {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): Obj | undefined => {
    if (depth > 6 || v == null || seen.has(v)) return undefined;
    if (typeof v === "object") seen.add(v);
    if (Array.isArray(v)) { for (const x of v) { const r = walk(x, depth + 1); if (r) return r; } return undefined; }
    if (!isObj(v)) return undefined;
    if (isRecipe(v)) return v;
    for (const k of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) { const r = walk(v[k], depth + 1); if (r) return r; }
    return undefined;
  };
  for (const b of blocks) { const r = walk(parseLoose(b.trim()), 0); if (r) return r; }
  return undefined;
}

/** Text from JSON-LD: entities decoded, tags dropped, spaces tidied. */
const clean = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? stripHtml(decodeEntities(String(v))).replace(/\s+/g, " ").trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const firstText = (v: unknown, key = "name"): string | undefined => {
  for (const x of list(v)) { const s = isObj(x) ? clean(x[key]) : clean(x); if (s) return s; }
  return undefined;
};

function imageOf(v: unknown): string | undefined {
  for (const x of list(v)) {
    const u = isObj(x) ? (x.url ?? x.contentUrl) : x;
    if (typeof u === "string" && isHttpUrl(u.trim())) return u.trim();
  }
  return undefined;
}

/** recipeInstructions: a string, a list of strings, HowToSteps, or HowToSections of steps. */
function stepsOf(v: unknown): string[] {
  const out: string[] = [];
  const add = (x: unknown) => {
    if (typeof x === "string") {
      // one block of text: its list items or lines are the steps
      const html = x.includes("<li") ? x.split(/<\/li>/i).map((p) => p.replace(/^[\s\S]*<li[^>]*>/i, "")) : x.split(/<br\s*\/?>|\n+|<\/p>/i);
      for (const p of html) { const t = clean(p).replace(/^\d{1,2}[.)]\s+/, ""); if (t) out.push(t); }
      return;
    }
    if (!isObj(x)) return;
    const type = x["@type"];
    if (type === "HowToSection" || (Array.isArray(type) && type.includes("HowToSection")) || (x.itemListElement && !x.text)) {
      const name = clean(x.name);
      if (name) out.push(`### ${name}`);
      for (const y of list(x.itemListElement)) add(y);
      return;
    }
    const t = clean(x.text) || clean(x.name);
    if (t) out.push(t);
  };
  for (const x of list(v)) add(x);
  // a section heading with nothing under it, or the recipe's name repeated as a step, isn't a step
  return out.filter((s, i) => !(s.startsWith("### ") && (i === out.length - 1 || out[i + 1].startsWith("### "))));
}

/** recipeIngredient lines; one that ends in ":" ("For the sauce:") starts a group. */
function ingredientsOf(v: unknown): string[] {
  return list(v).map(clean).filter(Boolean).map((s) => (/^[^\d]{2,50}:$/.test(s) ? `### ${s.slice(0, -1)}` : s));
}

const tagOf = (s: string) => s.toLowerCase().replace(/[#,]/g, "").trim().replace(/\s+/g, "-");

export function fromLd(o: Obj): Imported {
  const yieldText = list(o.recipeYield).map(clean).filter(Boolean);
  const servings = yieldText.find((s) => /^\d+$/.test(s)) ?? yieldText[0];
  const intro = clean(o.description);
  return {
    title: clean(o.name) || undefined,
    intro: intro.length > 700 ? intro.slice(0, 699).replace(/\s+\S*$/, "") + "…" : intro || undefined,
    servings: servings && /^\d+$/.test(servings) ? Number(servings) : servings,
    prep: timeText(clean(o.prepTime)), cook: timeText(clean(o.cookTime)), total: timeText(clean(o.totalTime)),
    image: imageOf(o.image),
    author: firstText(o.author),
    tags: [...new Set([...list(o.recipeCategory), ...list(o.recipeCuisine)].map(clean).flatMap((s) => s.split(/,\s*/)).filter((s) => s && s.length < 30).map(tagOf))].slice(0, 5),
    ingredients: ingredientsOf(o.recipeIngredient ?? o.ingredients),
    steps: stepsOf(o.recipeInstructions),
  };
}

/** The recipe in a page's JSON-LD blocks, if it has one with ingredients or steps. */
export function recipeFromLd(blocks: string[]): Imported | undefined {
  const o = findRecipeLd(blocks);
  if (!o) return undefined;
  const r = fromLd(o);
  return r.ingredients.length || r.steps.length ? r : undefined;
}
