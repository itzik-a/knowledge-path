/* Edit a recipe's details: title (renames the file), servings, times, source link, photo, tags. */
import { useRef, useState, type FormEvent } from "react";
import { recipeTags } from "../../shared/recipes.ts";
import { isHttpUrl } from "../../shared/vault.ts";
import { docHref, go } from "../lib/route";
import { updateRecipe } from "../state/actions";
import { useIndex } from "../state/store";
import { Field, Sheet, closeSheet } from "./ui";

const raw = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

export function RecipeSheet({ path, onClose }: { path: string; onClose: () => void }) {
  const ix = useIndex();
  const d = ix.docs.get(path);
  const [title, setTitle] = useState(d?.title ?? "");
  const [servings, setServings] = useState(raw(d?.fm.servings));
  const [prep, setPrep] = useState(raw(d?.fm.prep));
  const [cook, setCook] = useState(raw(d?.fm.cook));
  const [source, setSource] = useState(raw(d?.fm.source));
  const [image, setImage] = useState(raw(d?.fm.image));
  const [tags, setTags] = useState(d ? recipeTags(d.fm).join(", ") : "");
  const [err, setErr] = useState("");
  const form = useRef<HTMLFormElement>(null);
  if (!d) return null;

  function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("It needs a title."); return; }
    if (source.trim() && !isHttpUrl(source.trim())) { setErr("The link should start with https://"); return; }
    if (image.trim() && !isHttpUrl(image.trim())) { setErr("The photo should be a web address (https://…)."); return; }
    const next = updateRecipe(path, {
      title, servings, prep, cook, source, image,
      tags: tags.split(/[,\n]/).map((t) => t.trim().replace(/^#/, "").replace(/\s+/g, "-").toLowerCase()).filter(Boolean),
    });
    closeSheet(form.current);
    if (next !== path) go(docHref(next));
  }

  return (
    <Sheet title="Details" onClose={onClose}>
      <form ref={form} className="form-grid" onSubmit={save}>
        <Field label="Title"><input className="text-input" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="form-row">
          <Field label="Servings" hint="A number scales it; or e.g. “12 cookies”"><input className="text-input" dir="auto" value={servings} onChange={(e) => setServings(e.target.value)} placeholder="4" /></Field>
          <Field label="Tags"><input className="text-input" dir="auto" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dinner, vegetarian" /></Field>
        </div>
        <div className="form-row">
          <Field label="Prep"><input className="text-input" dir="auto" value={prep} onChange={(e) => setPrep(e.target.value)} placeholder="15 min" /></Field>
          <Field label="Cook"><input className="text-input" dir="auto" value={cook} onChange={(e) => setCook(e.target.value)} placeholder="1 h 10 min" /></Field>
        </div>
        <Field label="Source" hint={source.trim() && source.trim() !== raw(d.fm.source) ? "A new link is read again on the next sync (an empty recipe is filled in)." : undefined}>
          <input className="text-input" type="url" inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="https://…" value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <Field label="Photo"><input className="text-input" type="url" inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="https://… (an image's address)" value={image} onChange={(e) => setImage(e.target.value)} /></Field>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn primary" type="submit">Save</button>
      </form>
    </Sheet>
  );
}
