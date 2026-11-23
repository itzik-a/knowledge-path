/* #recipes: every recipe as a card (search by name or ingredient, filter by tag, sort); and one recipe's page
   (#doc/Recipes/<name>.md): photo, times, servings to scale by, ingredients, steps, notes, the days cooked. */
import { useMemo, useState } from "react";
import type { Doc, Index } from "../../shared/index.ts";
import { allIngredients, allSteps, parseRecipe, recipeTags } from "../../shared/recipes.ts";
import { CookedLog, hasImperial, IngredientList, RECIPE_EMOJI, RecipeCard, ScaleControl, Stars, StepList, UnitsToggle, useMetric, useScale } from "../components/recipes";
import { IconBack, IconCart, IconEdit, IconExternal, IconMore, IconPlay, IconPlus, IconSearch } from "../components/Icons";
import { SHOPPING_PATH } from "../../shared/shopping.ts";
import { shoppingLeft } from "./Shopping";
import { unlockAudio } from "../lib/timers";
import { Markdown } from "../components/Markdown";
import { NoteBody } from "../components/NoteBody";
import { RecipeSheet } from "../components/RecipeSheet";
import { Menu, Seg, useSessionState } from "../components/ui";
import { medDate } from "../lib/dates";
import { back } from "../lib/route";
import { openSheet } from "../lib/sheets";
import { deleteDocs, patch } from "../state/actions";
import { useIndex } from "../state/store";
import { DocTags, DocTopics, LinkedFrom, TitleInput } from "./DocPage";

export const recipesOf = (ix: Index) => [...ix.docs.values()].filter((d) => d.kind === "recipe");

type Sort = "recent" | "az" | "cooked";
const lastCooked = (d: Doc) => d.cooking?.cooked[0] ?? "";

export function Recipes() {
  const ix = useIndex();
  const all = useMemo(() => recipesOf(ix), [ix]);
  const [q, setQ] = useSessionState("knowledgePath.recipes.q", "");
  const [tag, setTag] = useSessionState<string | null>("knowledgePath.recipes.tag", null);
  const [sort, setSort] = useSessionState<Sort>("knowledgePath.recipes.sort", "recent");
  const tags = useMemo(() => {
    const n = new Map<string, number>();
    for (const d of all) for (const t of recipeTags(d.fm)) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [all]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const toBuy = shoppingLeft(ix.docs.get(SHOPPING_PATH)?.body);
  const shown = all
    .filter((d) => !tag || recipeTags(d.fm).includes(tag))
    // every word in the title or in an ingredient: "eggplant tahini"
    .filter((d) => words.every((w) => d.title.toLowerCase().includes(w) || d.cooking?.ingredients.some((x) => x.includes(w)) || recipeTags(d.fm).some((t) => t.includes(w))))
    .sort((a, b) =>
      sort === "az" ? a.title.localeCompare(b.title)
      : sort === "cooked" ? (b.cooking?.cooked.length ?? 0) - (a.cooking?.cooked.length ?? 0) || lastCooked(b).localeCompare(lastCooked(a)) || a.title.localeCompare(b.title)
      : String(b.fm.added ?? "").localeCompare(String(a.fm.added ?? "")) || b.mtime - a.mtime);

  return (
    <>
      <div className="page-head row-head">
        <div>
          <h1 className="display">Recipes</h1>
          {all.length > 0 && <p className="muted">{all.length} {all.length === 1 ? "recipe" : "recipes"}</p>}
        </div>
        <button type="button" className="btn primary sm" onClick={() => openSheet({ kind: "capture", init: { mode: "recipe" } })}><IconPlus /> New recipe</button>
      </div>

      <a className="card journal-card" href="#shopping">
        <span className="journal-icon"><IconCart /></span>
        <span className="grow"><b>Shopping list</b><span className="muted small">{toBuy ? `${toBuy} to buy` : "Empty: add a recipe's ingredients from its page"}</span></span>
        <span className="chev">›</span>
      </a>

      {all.length ? (
        <>
          <div className="recipe-tools">
            <label className="search-field">
              <IconSearch />
              <input className="text-input" type="search" dir="auto" placeholder="A name or an ingredient" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search recipes" />
            </label>
            <Seg<Sort> label="Sort" value={sort} onChange={setSort} options={[{ id: "recent", label: "Recent" }, { id: "az", label: "A–Z" }, { id: "cooked", label: "Most cooked" }]} />
          </div>
          {tags.length > 0 && (
            <div className="chips" role="group" aria-label="Tags">
              {tags.map((t) => <button key={t} type="button" className="chip" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)} dir="auto">#{t}</button>)}
            </div>
          )}
          {shown.length
            ? <ul className="recipe-grid">{shown.map((d) => <RecipeCard key={d.path} d={d} />)}</ul>
            : <p className="muted card">Nothing matches{q ? ` “${q}”` : ""}{tag ? ` in #${tag}` : ""}.</p>}
        </>
      ) : (
        <section className="card empty">
          <h2>No recipes yet</h2>
          <p className="muted">Write one down, or paste a recipe's link and it's filled in for you. Scale it to the servings you need, and cook from it step by step.</p>
          <p className="muted small">Each recipe is a note in <code>Recipes/</code>: ingredients, steps and the days you made it, plain Markdown.</p>
          <button type="button" className="btn primary" onClick={() => openSheet({ kind: "capture", init: { mode: "recipe" } })}><IconPlus /> New recipe</button>
        </section>
      )}
    </>
  );
}

export function RecipePage({ d, ix }: { d: Doc; ix: Index }) {
  const r = d.recipe!;
  const p = useMemo(() => parseRecipe(d.body), [d.body]);
  const blank = !allIngredients(p).some((x) => x.text) && !allSteps(p).some((x) => x.text);
  const [editing, setEditing] = useState(blank && r.enrich !== "pending");
  const [details, setDetails] = useState(false);
  const scale = useScale(d.path, r);
  const [metricOn] = useMetric();
  const imperial = useMemo(() => hasImperial(p), [p]);
  const metric = metricOn && imperial;
  const times = [r.prep && `Prep ${r.prep}`, r.cook && `Cook ${r.cook}`, r.total && `Total ${r.total}`].filter(Boolean).join(" · ");

  return (
    <>
      <button type="button" className="back link-row" onClick={() => back("#recipes")}><IconBack /> Recipes</button>
      <section className="card res-head">
        <div className="res-top">
          {r.image ? <img className="res-image" src={r.image} alt="" referrerPolicy="no-referrer" /> : <span className="res-emoji" aria-hidden="true">{RECIPE_EMOJI}</span>}
          <div className="res-title">
            <span className="eyebrow">Recipe{r.site ? ` · ${r.site}` : ""}{r.author ? ` · ${r.author}` : ""}</span>
            <TitleInput d={d} />
            {(times || r.yield) && <p className="muted small" dir="auto">{[times, r.yield].filter(Boolean).join(" · ")}</p>}
          </div>
          <Menu label="More" icon={<IconMore />} items={[
            { label: "Edit details", run: () => setDetails(true) },
            { label: editing ? "Done editing" : "Edit the recipe", run: () => setEditing((x) => !x) },
            r.source ? { label: "Copy link", run: () => void navigator.clipboard?.writeText(r.source!) } : null,
            r.source ? { label: "Fetch the recipe again", run: () => patch(d.path, { enrich: "pending", enrichError: undefined }) } : null,
            { label: "Delete", danger: true, run: async () => { if (await deleteDocs([d.path])) back("#recipes"); } },
          ]} />
        </div>
        <div className="btn-row">
          {(p.steps.length > 0 || p.ingredients.length > 0) && <button type="button" className="btn primary sm" onClick={() => { unlockAudio(); openSheet({ kind: "cook", path: d.path }); }}><IconPlay /> Cook</button>}
          {p.ingredients.length > 0 && <button type="button" className="btn sm" onClick={() => openSheet({ kind: "shop", path: d.path })}><IconCart /> Add to list</button>}
          {r.source && <a className="btn sm" href={r.source} target="_blank" rel="noopener">Source <IconExternal /></a>}
          <button type="button" className="btn ghost sm" onClick={() => setEditing((x) => !x)}><IconEdit /> {editing ? "Done" : "Edit"}</button>
        </div>
        {r.enrich === "pending" && r.source && <p className="muted small">Fetching the recipe from its page: it arrives after the next sync (a minute or two).</p>}
        {r.enrich === "failed" && <p className="muted small">Couldn't read the recipe from its page{r.enrichError ? ` (${r.enrichError})` : ""}. Paste it in with Edit.</p>}
        <div className="recipe-facts">
          <Stars path={d.path} value={r.rating} />
          {p.cooked.length > 0 && <span className="muted small">Cooked {p.cooked.length}× · last {medDate(p.cooked[0].date)}</span>}
        </div>
        <DocTopics ix={ix} d={d} />
      </section>

      {editing ? (
        <section className="card">
          <div className="card-head">
            <h2>Edit the recipe</h2>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>Done</button>
          </div>
          <p className="muted small">One ingredient per line under <code>## Ingredients</code> (<code>### For the sauce</code> starts a group), numbered steps under <code>## Steps</code>.</p>
          <NoteBody path={d.path} body={d.body} editing autoFocus={blank} />
        </section>
      ) : (
        <>
          {p.intro && <section className="card"><Markdown body={p.intro} from={d.path} /></section>}
          <section className="card">
            <div className="card-head">
              <h2>Ingredients</h2>
              {p.ingredients.length > 0 && <ScaleControl s={scale} />}
            </div>
            {imperial && <UnitsToggle />}
            {p.ingredients.length ? <IngredientList groups={p.ingredients} factor={scale.factor} metric={metric} /> : <p className="muted small">None yet: add them with Edit.</p>}
          </section>
          <section className="card">
            <h2>Steps</h2>
            {p.steps.length ? <StepList groups={p.steps} metric={metric} /> : <p className="muted small">None yet: add them with Edit.</p>}
          </section>
          {p.notes && (
            <section className="card">
              <h2>Notes</h2>
              <Markdown body={p.notes} from={d.path} />
            </section>
          )}
        </>
      )}

      <CookedLog d={d} cooked={p.cooked} />
      <LinkedFrom ix={ix} path={d.path} />
      <DocTags d={d} />
      {details && <RecipeSheet path={d.path} onClose={() => setDetails(false)} />}
    </>
  );
}
