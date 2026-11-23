/* #shopping: the shopping list (Shopping list.md), by aisle. Tap to tick off; ticked ones sink to the bottom of
   their aisle until cleared. Add anything by typing; recipes add their ingredients from their page. */
import { useMemo, useState, type FormEvent } from "react";
import { AISLES, parseShopping, SHOPPING_PATH, type ShopItem } from "../../shared/shopping.ts";
import { IconBack, IconCheck, IconClose, IconPlus } from "../components/Icons";
import { NoteBody } from "../components/NoteBody";
import { back } from "../lib/route";
import { addToShopping, clearShopping, removeShopItem, toggleStep } from "../state/actions";
import { useIndex } from "../state/store";

export const shoppingLeft = (body?: string) => (body ? parseShopping(body).filter((x) => !x.done).length : 0);

export function Shopping() {
  const ix = useIndex();
  const d = ix.docs.get(SHOPPING_PATH);
  const items = useMemo(() => parseShopping(d?.body ?? ""), [d?.body]);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const left = items.filter((x) => !x.done).length;
  const done = items.length - left;
  const groups = useMemo(() => {
    const m = new Map<string, ShopItem[]>();
    for (const it of items) { const a = m.get(it.aisle); if (a) a.push(it); else m.set(it.aisle, [it]); }
    const rank = (a: string) => { const i = AISLES.indexOf(a as (typeof AISLES)[number]); return i < 0 ? AISLES.length : i; };
    return [...m].sort((a, b) => rank(a[0]) - rank(b[0])).map(([aisle, list]) => [aisle, [...list.filter((x) => !x.done), ...list.filter((x) => x.done)]] as const);
  }, [items]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const lines = text.split(/\n|,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return;
    addToShopping(lines.map((t) => ({ text: t })), undefined, true);
    setText("");
  };

  return (
    <>
      <button type="button" className="back link-row" onClick={() => back("#recipes")}><IconBack /> Recipes</button>
      <div className="page-head row-head">
        <div>
          <h1 className="display">Shopping list</h1>
          <p className="muted">{items.length ? `${left} to buy${done ? ` · ${done} in the cart` : ""}` : "Nothing on it yet"}</p>
        </div>
        {d && <button type="button" className="btn ghost sm" onClick={() => setEditing((x) => !x)}>{editing ? "Done" : "Edit as text"}</button>}
      </div>

      <form className="card shop-add" onSubmit={add}>
        <input className="text-input" dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something: milk, 2 lemons…" aria-label="Add to the list" enterKeyHint="done" />
        <button type="submit" className="btn primary sm" disabled={!text.trim()}><IconPlus /> Add</button>
      </form>

      {editing && d ? (
        <section className="card">
          <p className="muted small">The list is the note <code>{SHOPPING_PATH}</code>: one <code>- [ ]</code> line per item under <code>## Aisle</code> headings.</p>
          <NoteBody path={SHOPPING_PATH} body={d.body} editing autoFocus />
        </section>
      ) : items.length ? (
        <>
          {groups.map(([aisle, list]) => (
            <section key={aisle} className="card shop-aisle">
              <h2 dir="auto">{aisle}</h2>
              <ul className="shop-list">
                {list.map((it) => (
                  <li key={it.line} className={it.done ? "done" : undefined}>
                    <button type="button" className="ing-check" role="checkbox" aria-checked={it.done} onClick={() => toggleStep(SHOPPING_PATH, it.line)}>
                      <span className={`pick${it.done ? " on" : ""}`} aria-hidden="true">{it.done && <IconCheck width={13} height={13} />}</span>
                      <span className="shop-text">
                        <span dir="auto">{it.text}</span>
                        {it.recipes.length > 0 && <span className="muted small" dir="auto">{it.recipes.join(" · ")}</span>}
                      </span>
                    </button>
                    <button type="button" className="icon-btn subtle" onClick={() => removeShopItem(it.line)} aria-label={`Remove ${it.text}`}><IconClose width={16} height={16} /></button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {done > 0 && <button type="button" className="btn ghost" onClick={clearShopping}>Clear {done} ticked</button>}
        </>
      ) : (
        <section className="card empty">
          <h2>The list is empty</h2>
          <p className="muted">Add things above, or open a recipe and choose <b>Add to list</b>: its ingredients come in at the servings you picked, sorted by aisle, and the same things add up.</p>
        </section>
      )}
    </>
  );
}
