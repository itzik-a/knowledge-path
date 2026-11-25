/* Add or edit a habit: icon, name, how often (every day, or some times a week), what to log (just the day,
   an amount with a unit like "min" or "pages" and the usual amount, or a timer with a goal in hours, e.g. a fast),
   topics and a line about it when adding. */
import { useRef, useState, type FormEvent } from "react";
import { habitIntro, setHabitIntro, type Goal } from "../../shared/habits.ts";
import { splitFrontmatter } from "../../shared/vault.ts";
import { docHref, go } from "../lib/route";
import { createHabit, setBodyOf, updateHabit } from "../state/actions";
import { readFile, useIndex } from "../state/store";
import { TopicPicker } from "./bits";
import { Field, Seg, Sheet, Stepper, Switch, closeSheet } from "./ui";

export function HabitSheet({ path, topics: startTopics, onClose }: { path?: string; topics?: string[]; onClose: () => void }) {
  const ix = useIndex();
  const d = path ? ix.docs.get(path) : undefined;
  const h = d?.habit;
  const [name, setName] = useState(d?.title ?? "");
  const [icon, setIcon] = useState(h?.icon ?? "");
  const [per, setPer] = useState<"day" | "week" | "any">(h?.goal.per ?? "day");
  const [times, setTimes] = useState(h?.goal.per === "week" ? h.goal.times : 3);
  const [mode, setMode] = useState<"day" | "amount" | "timer">(h?.timer ? "timer" : h?.unit ? "amount" : "day");
  const [unit, setUnit] = useState(h?.timer ? "" : h?.unit ?? "");
  const [target, setTarget] = useState(h?.target != null ? String(h.target) : "");
  const [topics, setTopics] = useState<string[]>(startTopics ?? []);
  const [desc, setDesc] = useState(d ? habitIntro(d.body) : "");
  const [card, setCard] = useState(!!h?.card);
  const [err, setErr] = useState("");
  const form = useRef<HTMLFormElement>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Give it a name."); return; }
    const goal: Goal = per === "week" ? { per: "week", times } : { per };
    const u = mode === "timer" ? "h" : mode === "amount" ? unit.trim() || "times" : undefined;
    const tn = Number(target.replace(",", "."));
    const fields = { name: name.trim(), icon: icon.trim() || undefined, goal, unit: u, target: u && target.trim() && Number.isFinite(tn) && tn > 0 ? tn : undefined, timer: mode === "timer", card };
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
          <Seg<"day" | "week" | "any"> label="How often" value={per} onChange={setPer} options={[{ id: "day", label: "Every day" }, { id: "week", label: "Times a week" }, { id: "any", label: "Whenever" }]} />
          {per === "any" && <p className="muted small">No schedule: log it when you do it. No streak, and it's never due on Home.</p>}
          {per === "week" && <Stepper label="Times a week" value={times} onChange={setTimes} min={1} max={6} step={1} />}
        </div>
        <div className="field">
          <span className="field-label">What to log</span>
          <Seg<"day" | "amount" | "timer"> label="What to log" value={mode} onChange={setMode} options={[{ id: "day", label: "The day" }, { id: "amount", label: "An amount" }, { id: "timer", label: "A timer" }]} />
          {mode === "amount" && <p className="muted small">Minutes, pages, km… each time you log.</p>}
          {mode === "timer" && (
            <>
              <p className="muted small">Start it, then end it, e.g. a fast. You choose how long each time you start; the hours go in the log on the day it ends.</p>
              <Field label="Usual length in hours" hint="Optional, e.g. 16 for 16:8: picked first when you start.">
                <input className="text-input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="16" />
              </Field>
            </>
          )}
          {mode === "amount" && (
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
        <div className="field">
          <label className="switch-row"><Switch on={card} onChange={setCard} label="Own card on Home" /> Own card on Home</label>
          <p className="muted small">{mode === "timer" ? "Its timer and progress get a card of their own" : "It gets a card of its own"}, and it leaves the Habits card and its count for today. Move or hide the card in Vault & settings → Home.</p>
        </div>
        <Field label="About it">
          <textarea className="text-input" dir="auto" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional: why, when, how much" />
        </Field>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn primary" type="submit">{d ? "Save" : "Add habit"}</button>
      </form>
    </Sheet>
  );
}
