/* Add a recipe's ingredients to the shopping list, at the servings chosen on its page: everything is ticked
   except spices and water (usually in the cupboard); untick what's already at home. */
import { useMemo, useRef, useState } from "react";
import { allIngredients, parseRecipe, showIngredient } from "../../shared/recipes.ts";
import { aisleOf } from "../../shared/shopping.ts";
import { addToShopping } from "../state/actions";
import { useIndex } from "../state/store";
import { IconCheck } from "./Icons";
import { hasImperial, stripMd, useMetric, useScale } from "./recipes";
import { Sheet, closeSheet } from "./ui";

const usuallyHave = (name: string) => aisleOf(name) === "Spices" || /^(water|ice|מים|קרח)\b/.test(name);

export function ShoppingSheet({ path, onClose }: { path: string; onClose: () => void }) {
  const ix = useIndex();
  const d = ix.docs.get(path);
  const scale = useScale(path, d?.recipe);
  const [metricOn] = useMetric();
  const items = useMemo(() => { const p = parseRecipe(d?.body ?? ""); const metric = metricOn && hasImperial(p); return allIngredients(p).map((it) => {
    const s = showIngredient(it, scale.factor, metric);
    return { line: it.line, text: stripMd(`${s.amount ? s.amount + " " : ""}${s.rest}`).trim(), name: it.name || it.text.toLowerCase() };
  }); }, [d?.body, scale.factor, metricOn]);
  const [on, setOn] = useState<Set<number>>(() => new Set(items.filter((x) => !usuallyHave(x.name)).map((x) => x.line)));
  const box = useRef<HTMLDivElement>(null);
  if (!d) return null;
  const chosen = items.filter((x) => on.has(x.line));
  const add = () => {
    addToShopping(chosen.map((x) => ({ text: x.text, recipe: d.title })), `Added ${chosen.length} from ${d.title}`);
    closeSheet(box.current);
  };
  return (
    <Sheet title="Add to the shopping list" onClose={onClose}>
      <div ref={box} className="form-grid">
        <p className="muted small">{scale.base ? `For ${scale.value} servings` : scale.factor !== 1 ? `×${scale.value}` : "As written"}. Untick what you already have.</p>
        <ul className="ing-list shop-pick">
          {items.map((x) => {
            const c = on.has(x.line);
            return (
              <li key={x.line}>
                <button type="button" className={`ing-check${c ? " picked" : ""}`} role="checkbox" aria-checked={c}
                  onClick={() => setOn((s) => { const n = new Set(s); if (n.has(x.line)) n.delete(x.line); else n.add(x.line); return n; })}>
                  <span className={`pick${c ? " on" : ""}`} aria-hidden="true">{c && <IconCheck width={13} height={13} />}</span>
                  <span dir="auto">{x.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="btn-row">
          <button type="button" className="btn primary" disabled={!chosen.length} onClick={add}>Add {chosen.length || ""} to the list</button>
          <button type="button" className="btn ghost sm" onClick={() => setOn(new Set(on.size === items.length ? [] : items.map((x) => x.line)))}>{on.size === items.length ? "None" : "All"}</button>
        </div>
      </div>
    </Sheet>
  );
}
