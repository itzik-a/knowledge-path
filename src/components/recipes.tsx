/* Recipe pieces: the list row and card, the scale control (servings or ×), the ingredient list (scaled),
   step text with its times marked, the stars, and the Cooked log. */
import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import type { Doc, Index } from "../../shared/index.ts";
import {
  allIngredients, allSteps, convertText, findTimes, fmtFraction, fmtMinutes, showIngredient, toMetric,
  type Group, type IngredientLine, type ParsedRecipe, type Recipe, type StepLine,
} from "../../shared/recipes.ts";
import { todayISO } from "../../shared/vault.ts";
import { medDate, shortDate } from "../lib/dates";
import { docHref } from "../lib/route";
import { logCooked, setRating, unlogCooked } from "../state/actions";
import { TopicChips } from "./bits";
import { IconCheck, IconEdit, IconTrash } from "./Icons";
import { Seg, Stepper, useSessionState } from "./ui";

export const RECIPE_EMOJI = "🍲";

/** "45 min · cooked 3×" */
export function recipeMeta(d: Doc): string {
  const c = d.cooking;
  return [
    c?.minutes ? fmtMinutes(c.minutes) : undefined,
    d.recipe?.servings ? `serves ${d.recipe.yield ?? d.recipe.servings}` : undefined,
    c?.cooked.length ? `cooked ${c.cooked.length}×` : undefined,
  ].filter(Boolean).join(" · ");
}

export function RecipeRow({ d, ix, showTopics = true }: { d: Doc; ix: Index; showTopics?: boolean }) {
  const r = d.recipe!;
  return (
    <li>
      <a className="item-row" href={docHref(d.path)}>
        {r.image ? <img className="thumb" src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="thumb emoji" aria-hidden="true">{RECIPE_EMOJI}</span>}
        <span className="item-main">
          <span className="item-title" dir="auto">{d.title}</span>
          <span className="item-meta" dir="auto">{recipeMeta(d) || "Recipe"}</span>
          {(showTopics || r.enrich === "pending") && (
            <span className="item-tags">
              {r.enrich === "pending" && <span className="tag">Fetching the recipe…</span>}
              {showTopics && <TopicChips ix={ix} path={d.path} max={2} />}
            </span>
          )}
        </span>
      </a>
    </li>
  );
}

export function RecipeCard({ d }: { d: Doc }) {
  const r = d.recipe!;
  return (
    <li>
      <a className="recipe-card" href={docHref(d.path)}>
        {r.image ? <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="recipe-ph" aria-hidden="true">{RECIPE_EMOJI}</span>}
        <span className="recipe-card-text">
          <b dir="auto">{d.title}</b>
          <span className="muted small" dir="auto">{r.enrich === "pending" ? "Fetching the recipe…" : recipeMeta(d) || (r.site ?? "Recipe")}</span>
        </span>
      </a>
    </li>
  );
}

// ── scale ─────────────────────────────────────────────────────

/** How much to make: servings when the recipe says how many, else a multiplier. Kept for this session, per recipe,
    so cook mode and the shopping list use what the page shows. */
export function useScale(path: string, r?: Recipe) {
  const base = r?.servings;
  const [v, setV] = useSessionState<number | null>(`knowledgePath.scale.${path}`, null);
  const value = v ?? base ?? 1;
  const factor = base ? value / base : value;
  return { base, value, factor, set: (n: number) => setV(n === (base ?? 1) ? null : n), changed: v != null && v !== (base ?? 1) };
}

export function ScaleControl({ s }: { s: ReturnType<typeof useScale> }) {
  return (
    <div className="scale-ctl">
      {s.base
        ? <Stepper label="Servings" value={s.value} onChange={s.set} min={1} max={99} step={s.value < 2 && s.base < 2 ? 0.5 : 1} format={(v) => fmtFraction(v)} />
        : <Stepper label="Amount" value={s.value} onChange={s.set} min={0.5} max={10} step={0.5} format={(v) => `×${fmtFraction(v)}`} />}
      {s.changed && <button type="button" className="btn ghost sm" onClick={() => s.set(s.base ?? 1)}>Reset</button>}
    </div>
  );
}

// ── units ─────────────────────────────────────────────────────

/** Metric (grams, ml, °C) or as written: one choice per device, shared by every recipe view. Metric by default. */
const UNITS_KEY = "knowledgePath.units";
const unitLs = new Set<() => void>();
const readMetric = () => { try { return localStorage.getItem(UNITS_KEY) !== "written"; } catch { return true; } };
export function useMetric(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore((l) => { unitLs.add(l); return () => { unitLs.delete(l); }; }, readMetric);
  return [on, (v) => { try { localStorage.setItem(UNITS_KEY, v ? "metric" : "written"); } catch { /* ignore */ } unitLs.forEach((l) => l()); }];
}

/** Does metric change anything in this recipe (cups, ounces, °F, inches)? */
export function hasImperial(p: ParsedRecipe): boolean {
  return allIngredients(p).some((x) => (x.qty && toMetric(x.qty, x.unit, x.name)) || convertText(x.rest) !== x.rest)
    || allSteps(p).some((s) => convertText(s.text) !== s.text);
}

export function UnitsToggle() {
  const [metric, setMetric] = useMetric();
  return <Seg<"metric" | "written"> className="units-seg" label="Units" value={metric ? "metric" : "written"} onChange={(v) => setMetric(v === "metric")}
    options={[{ id: "metric", label: "Grams, °C" }, { id: "written", label: "As written" }]} />;
}

// ── ingredients and steps ─────────────────────────────────────

export function IngredientList({ groups, factor, metric = false, checked, onToggle }: {
  groups: Group<IngredientLine>[]; factor: number; metric?: boolean;
  /** cook mode: tap to tick off */
  checked?: Set<number>; onToggle?: (line: number) => void;
}) {
  return (
    <div className="ing-groups">
      {groups.map((g, gi) => (
        <div key={gi} className="ing-group">
          {g.title && <h3 dir="auto">{g.title}</h3>}
          <ul className="ing-list">
            {g.items.map((it) => {
              const s = showIngredient(it, factor, metric);
              const text = <>{s.amount && <b className={s.changed ? "ing-amt changed" : "ing-amt"}>{s.amount}</b>}{s.amount ? " " : ""}{stripMd(s.rest)}{s.original && <span className="muted ing-orig"> ({s.original})</span>}</>;
              if (!onToggle) return <li key={it.line} dir="auto">{text}</li>;
              const on = checked?.has(it.line) ?? false;
              return (
                <li key={it.line}>
                  <button type="button" className={`ing-check${on ? " on" : ""}`} role="checkbox" aria-checked={on} onClick={() => onToggle(it.line)}>
                    <span className="pick" aria-hidden="true">{on && <IconCheck width={13} height={13} />}</span>
                    <span dir="auto">{text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Markdown emphasis and links shown as their text (steps and ingredients are short; no need for the full renderer). */
export const stripMd = (s: string) => s
  .replace(/!\[\[[^\]]*\]\]/g, "")
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(\*|_)(.+?)\1/g, "$2");

/** A step's text with its times marked (cook mode makes them timer buttons). */
export function StepText({ text, time, metric = false }: { text: string; metric?: boolean; time?: (t: ReturnType<typeof findTimes>[number], label: string) => ReactNode }) {
  const plain = metric ? convertText(stripMd(text)) : stripMd(text);
  const times = findTimes(plain);
  const out: ReactNode[] = [];
  let at = 0;
  times.forEach((t, i) => {
    if (t.index > at) out.push(plain.slice(at, t.index));
    const label = plain.slice(t.index, t.index + t.length);
    out.push(time ? <span key={i}>{time(t, label)}</span> : <b key={i} className="step-time">{label}</b>);
    at = t.index + t.length;
  });
  out.push(plain.slice(at));
  return <span dir="auto">{out}</span>;
}

export function StepList({ groups, metric = false }: { groups: Group<StepLine>[]; metric?: boolean }) {
  let n = 0;
  return (
    <div className="step-groups">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && <h3 dir="auto">{g.title}</h3>}
          <ol className="recipe-steps">
            {g.items.map((s) => (
              <li key={s.line}><span className="step-n" aria-hidden="true">{++n}</span><p dir="auto"><StepText text={s.text} metric={metric} /></p></li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

// ── stars ─────────────────────────────────────────────────────

export function Stars({ path, value }: { path: string; value?: number }) {
  return (
    <div className="stars" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-pressed={!!value && n <= value} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRating(path, value === n ? undefined : n)}>
          {value && n <= value ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

// ── the Cooked log ────────────────────────────────────────────

export function CookedLog({ d, cooked }: { d: Doc; cooked: { date: string; note?: string }[] }) {
  const today = todayISO();
  const [edit, setEdit] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? cooked : cooked.slice(0, 8);
  const year = today.slice(0, 4);
  const madeToday = cooked.some((c) => c.date === today);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Cooked{cooked.length ? <span className="muted"> · {cooked.length}×</span> : null}</h2>
        {!madeToday && <button type="button" className="btn ghost sm" onClick={() => logCooked(d.path, today, undefined, null)}><IconCheck /> Made it today</button>}
      </div>
      {!cooked.length && <p className="muted small">Each time you make it, log the day (cook mode does it when you finish). A note per day too: what you changed, how it came out.</p>}
      <ul className="log-list">
        {shown.map((c) => (
          <li key={c.date}>
            {edit === c.date ? (
              <NoteForm initial={c.note} onSave={(note) => { logCooked(d.path, c.date, note); setEdit(null); }} onCancel={() => setEdit(null)} />
            ) : (
              <>
                <span className="grow">
                  <b>{c.date.startsWith(year) ? shortDate(c.date) : medDate(c.date)}</b>{c.date === today && <span className="muted"> · today</span>}
                  {c.note && <span className="muted small cooked-note" dir="auto">{c.note}</span>}
                </span>
                <button type="button" className="icon-btn subtle" aria-label={`A note for ${shortDate(c.date)}`} onClick={() => setEdit(c.date)}><IconEdit width={18} height={18} /></button>
                <button type="button" className="icon-btn subtle" aria-label={`Remove ${shortDate(c.date)}`} onClick={() => unlogCooked(d.path, c.date, c.note)}><IconTrash width={18} height={18} /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      {cooked.length > shown.length && <button type="button" className="btn ghost sm" onClick={() => setAll(true)}>Show all {cooked.length}</button>}
    </section>
  );
}

export function NoteForm({ initial = "", onSave, onCancel, placeholder = "How did it come out? What did you change?" }: { initial?: string; onSave: (note: string) => void; onCancel: () => void; placeholder?: string }) {
  const [v, setV] = useState(initial);
  const save = (e: FormEvent) => { e.preventDefault(); onSave(v.trim()); };
  return (
    <form className="inline-form grow" onSubmit={save}>
      <input className="text-input" dir="auto" autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} aria-label="Note" />
      <button type="submit" className="btn primary sm">Save</button>
      <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
    </form>
  );
}
