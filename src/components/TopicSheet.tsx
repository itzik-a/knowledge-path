/* Add or edit a topic: name, icon, colour (top-level topics; subtopics share their parent's), a one-line description. */
import { confirmAsk } from "../lib/confirm";
import { useRef, useState, type FormEvent } from "react";
import { topicHref, go } from "../lib/route";
import { createTopic, removeTopic, updateTopic } from "../state/actions";
import { useIndex } from "../state/store";
import { Field, Select, Sheet, closeSheet } from "./ui";

export function TopicSheet({ id, parent, onClose }: { id?: string; parent?: string; onClose: () => void }) {
  const ix = useIndex();
  const t = id ? ix.topics.get(id) : undefined;
  const [name, setName] = useState(t?.name ?? "");
  const [under, setUnder] = useState<string>(t?.parent ?? parent ?? "");
  const own = t ? ix.docs.get(t.path)?.fm : undefined;
  const [icon, setIcon] = useState(typeof own?.icon === "string" ? own.icon : "");
  const used = new Set([...ix.topics.values()].filter((x) => !x.parent && x.id !== id).map((x) => x.color));
  const [color, setColor] = useState<number>(t?.color ?? ([1, 2, 3, 4, 5, 6, 7, 8].find((c) => !used.has(c)) ?? 1));
  const [desc, setDesc] = useState(t?.description ?? "");
  const [err, setErr] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const top = !(t ? t.parent : under);

  function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Give it a name."); return; }
    try {
      const fields = { name: name.trim(), icon: icon.trim() || undefined, color: top ? color : undefined, description: desc.trim() || undefined };
      const next = t ? updateTopic(t.id, fields) : createTopic(under || undefined, fields);
      closeSheet(form.current);
      if (!t || next !== t.id) go(topicHref(next));
    } catch (x) { setErr((x as Error).message); }
  }

  return (
    <Sheet title={t ? "Edit topic" : "New topic"} onClose={onClose}>
      <form ref={form} className="form-grid" onSubmit={save}>
        <div className="form-row icon-row">
          <Field label="Icon">
            <input className="text-input emoji-input" value={icon} onChange={(e) => setIcon([...e.target.value].slice(-2).join(""))} placeholder={t?.icon ?? "🔭"} aria-label="Icon (an emoji)" />
          </Field>
          <Field label="Name">
            <input className="text-input" dir="auto" data-autofocus value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="e.g. Psychology" />
          </Field>
        </div>
        {!t && (
          <Field label="Inside">
            <Select<string> value={under} onChange={setUnder} label="Inside"
              options={[{ id: "", label: "Nothing (a top-level topic)" }, ...ix.topicOrder.map((x) => { const tt = ix.topics.get(x)!; return { id: x, label: `${"  ".repeat(tt.depth)}${tt.name}` }; })]} />
          </Field>
        )}
        {top && (
          <div className="field">
            <span className="field-label">Colour</span>
            <div className="colors" role="radiogroup" aria-label="Colour">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} style={{ background: `var(--s${c})` }} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
        )}
        <Field label="In one line">
          <input className="text-input" dir="auto" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What it covers" />
        </Field>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn primary" type="submit">{t ? "Save" : "Add topic"}</button>
        {t && (
          <button type="button" className="btn ghost danger" onClick={async () => {
            const subs = [...ix.topics.values()].filter((x) => x.id.startsWith(t.id + "/")).length;
            if (!(await confirmAsk({
              title: `Delete ${t.name}${subs ? ` and its ${subs} subtopic${subs > 1 ? "s" : ""}` : ""}?`,
              body: "The resources and notes in it stay (in the Inbox if it was their only topic). You can undo for a few seconds after.",
            }))) return;
            removeTopic(t.id);
            closeSheet(form.current);
            go(t.parent ? topicHref(t.parent) : "#topics");
          }}>Delete topic</button>
        )}
      </form>
    </Sheet>
  );
}
