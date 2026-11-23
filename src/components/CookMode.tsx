/* Cook mode (full screen, from a recipe's Cook button): gather the ingredients (tap to tick off, at the servings
   chosen on the page), then one step at a time in big type (swipe, arrows or the buttons). A time in a step is a
   button that starts a timer; several can run, and they ring when done. The screen stays on (Screen Wake Lock)
   while it's open. Progress is kept on this device for 12 hours, never in the recipe's file; Done logs the day. */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { parseRecipe, type FoundTime } from "../../shared/recipes.ts";
import { todayISO } from "../../shared/vault.ts";
import { addMinute, fmtLeft, leftOf, pauseTimer, removeTimer, resumeTimer, startTimer, unlockAudio, useTimers, type KitchenTimer } from "../lib/timers";
import { logCooked } from "../state/actions";
import { useIndex } from "../state/store";
import { useNow } from "./habits";
import { IconBack, IconCheck, IconClose, IconNext, IconPause, IconPlay, IconPlus } from "./Icons";
import { IngredientList, ScaleControl, StepText, useScale } from "./recipes";
import { Seg, useMedia } from "./ui";

interface Progress { step: number; ing: number[]; at: number }
const KEEP_MS = 12 * 3600_000;
const progKey = (path: string) => `knowledgePath.cook.${path}`;
function loadProgress(path: string): Progress | null {
  try {
    const v = JSON.parse(localStorage.getItem(progKey(path)) ?? "null") as Progress | null;
    return v && Date.now() - v.at < KEEP_MS ? v : null;
  } catch { return null; }
}

export function CookMode({ path, onClose }: { path: string; onClose: () => void }) {
  const ix = useIndex();
  const d = ix.docs.get(path);
  const p = useMemo(() => parseRecipe(d?.body ?? ""), [d?.body]);
  const steps = useMemo(() => p.steps.flatMap((g) => g.items.map((s) => ({ ...s, group: g.title }))), [p]);
  const ingCount = p.ingredients.reduce((n, g) => n + g.items.length, 0);
  const scale = useScale(path, d?.recipe);
  const saved = useMemo(() => loadProgress(path), [path]);
  const [step, setStep] = useState(Math.min(saved?.step ?? 0, Math.max(0, steps.length - 1)));
  const [ing, setIng] = useState<Set<number>>(() => new Set(saved?.ing ?? []));
  const wide = useMedia("(min-width: 900px)");
  const [pane, setPane] = useState<"ingredients" | "steps">(saved || !ingCount ? "steps" : "ingredients");
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState("");
  const [awake, setAwake] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const today = todayISO();

  useEffect(() => { dlg.current?.showModal(); }, []);
  // progress stays on this device (not in the file), for 12 hours
  useEffect(() => {
    try { localStorage.setItem(progKey(path), JSON.stringify({ step, ing: [...ing], at: Date.now() } satisfies Progress)); } catch { /* ignore */ }
  }, [path, step, ing]);

  // the screen stays on while cooking
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const get = async () => {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        lock = await navigator.wakeLock.request("screen");
        if (!live) { void lock.release(); return; }
        setAwake(true);
        lock.addEventListener("release", () => setAwake(false));
      } catch { setAwake(false); }
    };
    void get();
    const vis = () => { if (live) void get(); };
    document.addEventListener("visibilitychange", vis);
    return () => { live = false; document.removeEventListener("visibilitychange", vis); void lock?.release(); };
  }, []);

  const go = (n: number) => { setFinishing(false); setStep(Math.max(0, Math.min(steps.length - 1, n))); };
  const next = () => { if (step < steps.length - 1) go(step + 1); else setFinishing(true); };
  const prev = () => { if (finishing) setFinishing(false); else go(step - 1); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  // swipe between steps
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const down = (e: RPointerEvent) => { if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY }; };
  const up = (e: RPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
    // in a right-to-left recipe, the next step is to the left (swipe right)
    const rtl = getComputedStyle(e.currentTarget as Element).direction === "rtl";
    if ((dx < 0) !== rtl) next(); else prev();
  };

  function finish(log: boolean) {
    if (log) {
      const had = p.cooked.find((c) => c.date === today);
      logCooked(path, today, note.trim() || had?.note, had ? { note: had.note } : null);
    }
    try { localStorage.removeItem(progKey(path)); } catch { /* ignore */ }
    dlg.current?.close();
  }
  const close = () => dlg.current?.close();

  if (!d) return null;
  const cur = steps[step];
  const left = ingCount - ing.size;
  const showIngs = wide || pane === "ingredients";
  const showStep = wide || pane === "steps";

  return (
    <dialog ref={dlg} className="cook-dlg" aria-label={`Cooking ${d.title}`} onClose={onClose}>
      <header className="cook-bar">
        <button type="button" className="icon-btn" onClick={close} aria-label="Close cook mode"><IconClose /></button>
        <h2 className="cook-title" dir="auto">{d.title}</h2>
        <span className="muted small cook-awake" aria-live="polite">{awake ? "Screen stays on" : ""}</span>
      </header>

      {!wide && ingCount > 0 && steps.length > 0 && (
        <div className="cook-panes">
          <Seg<"ingredients" | "steps"> className="full" label="Show" value={pane} onChange={setPane}
            options={[{ id: "ingredients", label: `Ingredients${left > 0 && left < ingCount ? ` · ${left} left` : ""}` }, { id: "steps", label: `Steps · ${Math.min(step + 1, steps.length)}/${steps.length}` }]} />
        </div>
      )}

      <div className={`cook-body${wide ? " two" : ""}`}>
        {showIngs && ingCount > 0 && (
          <section className="cook-ings" aria-label="Ingredients">
            <div className="card-head">
              <h2>Ingredients</h2>
              <ScaleControl s={scale} />
            </div>
            <IngredientList groups={p.ingredients} factor={scale.factor} checked={ing}
              onToggle={(line) => setIng((s) => { const n = new Set(s); if (n.has(line)) n.delete(line); else n.add(line); return n; })} />
            {!wide && steps.length > 0 && <button type="button" className="btn primary cook-start" onClick={() => setPane("steps")}>{saved || step > 0 ? "Back to the steps" : "Start cooking"} <IconNext /></button>}
          </section>
        )}

        {showStep && (
          <section className="cook-step" onPointerDown={down} onPointerUp={up} onPointerCancel={() => { swipe.current = null; }} aria-live="polite">
            {!steps.length ? (
              <p className="muted">This recipe has no steps yet: add them on its page with Edit.</p>
            ) : finishing ? (
              <div className="cook-done">
                <span className="cook-done-mark" aria-hidden="true"><IconCheck width={34} height={34} /></span>
                <h3>That's it. Enjoy!</h3>
                <input className="text-input" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for next time (optional): what you changed, how it came out" aria-label="A note for next time" />
                <div className="btn-row">
                  <button type="button" className="btn primary" onClick={() => finish(true)}><IconCheck /> Log it as cooked today</button>
                  <button type="button" className="btn ghost" onClick={() => finish(false)}>Close without logging</button>
                </div>
              </div>
            ) : (
              <>
                <span className="eyebrow">Step {step + 1} of {steps.length}{cur.group ? ` · ${cur.group}` : ""}</span>
                <p className="cook-text" dir="auto">
                  <StepText text={cur.text} time={(t, label) => <TimeButton path={path} t={t} label={label} step={step + 1} />} />
                </p>
              </>
            )}
          </section>
        )}
      </div>

      <TimerStrip />

      {showStep && steps.length > 0 && (
        <footer className="cook-nav">
          <button type="button" className="btn ghost" onClick={prev} disabled={step === 0 && !finishing}><IconBack /> Back</button>
          <div className="cook-dots" aria-hidden="true">
            {steps.length <= 12 && steps.map((_, i) => <span key={i} className={i < step || finishing ? "done" : i === step ? "on" : undefined} />)}
          </div>
          {!finishing && <button type="button" className="btn primary" onClick={next}>{step < steps.length - 1 ? <>Next <IconNext /></> : <>Done <IconCheck /></>}</button>}
          {finishing && <span />}
        </footer>
      )}
    </dialog>
  );
}

function TimeButton({ path, t, label, step }: { path: string; t: FoundTime; label: string; step: number }) {
  const timers = useTimers();
  const running = timers.some((x) => x.path === path && x.label === `Step ${step} · ${t.label}` && !x.rang);
  return (
    <button type="button" className={`time-btn${running ? " on" : ""}`} disabled={running}
      onClick={() => startTimer(path, `Step ${step} · ${t.label}`, t.seconds)} aria-label={running ? `${label}: timer running` : `Start a ${t.label} timer`}>
      <IconPlay width={14} height={14} /> {label}
    </button>
  );
}

/** Running timers outside cook mode (a recipe's page, anywhere in the app): tap to go back to cooking. */
export function TimerDock({ onOpen }: { onOpen: (path: string) => void }) {
  const all = useTimers();
  const now = useNow(all.length ? 500 : 0);
  if (!all.length) return null;
  // the one that rang, else the one ending soonest
  const t = all.find((x) => x.rang) ?? [...all].sort((a, b) => leftOf(a, now.getTime()) - leftOf(b, now.getTime()))[0];
  return (
    <button type="button" className={`timer-dock${t.rang ? " ringing" : ""}`} onClick={() => { unlockAudio(); onOpen(t.path); }} aria-label={`${t.label}: ${t.rang ? "done" : fmtLeft(leftOf(t, now.getTime()))}. Open cook mode`}>
      <span className="timer-time">{t.rang ? "Done" : fmtLeft(leftOf(t, now.getTime()))}</span>
      <span className="small">{t.label}{all.length > 1 ? ` · +${all.length - 1}` : ""}</span>
    </button>
  );
}

/** The running timers, newest last. */
export function TimerStrip({ only }: { only?: string }) {
  const all = useTimers();
  const list = only ? all.filter((t) => t.path === only) : all;
  const now = useNow(list.length ? 500 : 0);
  if (!list.length) return null;
  return (
    <ul className="timer-strip" aria-label="Timers">
      {list.map((t) => <TimerChip key={t.id} t={t} now={now.getTime()} />)}
    </ul>
  );
}

function TimerChip({ t, now }: { t: KitchenTimer; now: number }) {
  const left = leftOf(t, now);
  const paused = t.ends == null && !t.rang;
  return (
    <li className={`timer-chip${t.rang ? " ringing" : ""}`}>
      <span className="timer-time" aria-live={t.rang ? "assertive" : "off"}>{t.rang ? "Done" : fmtLeft(left)}</span>
      <span className="timer-label muted small">{t.label}</span>
      {!t.rang && <button type="button" className="icon-btn subtle" onClick={() => (paused ? resumeTimer(t.id) : pauseTimer(t.id))} aria-label={paused ? "Resume" : "Pause"}>{paused ? <IconPlay width={16} height={16} /> : <IconPause width={16} height={16} />}</button>}
      <button type="button" className="icon-btn subtle" onClick={() => { unlockAudio(); addMinute(t.id); }} aria-label="One more minute"><IconPlus width={16} height={16} /></button>
      <button type="button" className="icon-btn subtle" onClick={() => removeTimer(t.id)} aria-label={t.rang ? "Dismiss" : "Cancel the timer"}><IconClose width={16} height={16} /></button>
    </li>
  );
}
