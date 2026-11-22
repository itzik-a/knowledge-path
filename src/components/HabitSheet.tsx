/* Add or edit a habit: icon, name, how often (every day, or some times a week), an optional amount to log
   (a unit like "min" or "pages", and the usual amount), topics and a line about it when adding. */
import { useRef, useState, type FormEvent } from "react";
import { habitIntro, setHabitIntro, type Goal } from "../../shared/habits.ts";
import { splitFrontmatter } from "../../shared/vault.ts";
import { docHref, go } from "../lib/route";
import { createHabit, setBodyOf, updateHabit } from "../state/actions";
import { readFile, useIndex } from "../state/store";
import { TopicPicker } from "./bits";
import { Field, Seg, Sheet, Stepper, closeSheet } from "./ui";

export function HabitSheet({ path, topics: startTopics, onClose }: { path?: string; topics?: string[]; onClose: () => void }) {
  const ix = useIndex();
  const d = path ? ix.docs.get(path) : undefined;
  const h = d?.habit;
  const [name, setName] = useState(d?.title ?? "");
  const [icon, setIcon] = useState(h?.icon ?? "");
  const [per, setPer] = useState<"day" | "week">(h?.goal.per ?? "day");
  const [times, setTimes] = useState(h?.goal.per === "week" ? h.goal.times : 3);
  const [amounts, setAmounts] = useState(!!h?.unit);
  const [unit, setUnit] = useState(h?.unit ?? "");
  const [target, setTarget] = useState(h?.target != null ? String(h.target) : "");
  const [topics, setTopics] = useState<string[]>(startTopics ?? []);
  const [desc, setDesc] = useState(d ? habitIntro(d.body) : "");
  const [err, setErr] = useState("");
  const form = useRef<HTMLFormElement>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Give it a name."); return; }
    const goal: Goal = per === "day" ? { per: "day" } : { per: "week", times };
    const u = amounts ? unit.trim() || "times" : undefined;
    const tn = Number(target.replace(",", "."));
    const fields = { name: name.trim(), icon: icon.trim() || undefined, goal, unit: u, target: u && target.trim() && Number.isFinite(tn) && tn > 0 ? tn : undefined };
    if (d) {
      const next = updateHabit(d.path, fields);
      const c = readFile(next);
      if (c != null && habitIntro(splitFrontmatter(c).body) !== desc.trim()) setBodyOf(next, setHabitIntro(splitFrontmatter(c).body, desc));
      closeSheet(form.current);
      if (next !== d.path) { history.replaceState(history.state, "", docHref(next)); window.dispatchEvent(new HashChangeEvent("hashchange")); }
    } else {
      const p = createHabit({ ...fields, topics, description: desc });
      closeSheet(form.current);
      go(docHref(p));
    }
  }

  return (
    <Sheet title={d ? "Edit habit" : "New habit"} onClose={onClose}>
      <form ref={form} className="form-grid" onSubmit={save}>
        <div className="form-row icon-row">
          <Field label="Icon">
            <input className="text-input emoji-input" value={icon} onChange={(e) => setIcon([...e.target.value].slice(-2).join(""))} placeholder="🔁" aria-label="Icon (an emoji)" />
          </Field>
          <Field label="Name">
            <input className="text-input" dir="auto" data-autofocus={!d || undefined} value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="e.g. Meditate" />
          </Field>
        </div>
        <div className="field">
          <span className="field-label">How often</span>
          <Seg<"day" | "week"> label="How often" value={per} onChange={setPer} options={[{ id: "day", label: "Every day" }, { id: "week", label: "Times a week" }]} />
          {per === "week" && <Stepper label="Times a week" value={times} onChange={setTimes} min={1} max={6} step={1} />}
        </div>
        <div className="field">
          <label className="switch-row">
            <input type="checkbox" className="task-box" checked={amounts} onChange={(e) => setAmounts(e.target.checked)} />
            <span>Log an amount each time <span className="muted small">(minutes, pages, km…)</span></span>
          </label>
          {amounts && (
            <div className="form-row">
              <Field label="Unit">
                <input className="text-input" dir="auto" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="min" autoCapitalize="off" />
              </Field>
              <Field label="Usual amount" hint="Filled in when you log.">
                <input className="text-input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="20" />
              </Field>
            </div>
          )}
        </div>
        {!d && (
          <div className="field">
            <span className="field-label">Topics</span>
            <TopicPicker value={topics} onChange={setTopics} />
          </div>
        )}
        <Field label="About it">
          <textarea className="text-input" dir="auto" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional: why, when, how much" />
        </Field>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn primary" type="submit">{d ? "Save" : "Add habit"}</button>
      </form>
    </Sheet>
  );
}
