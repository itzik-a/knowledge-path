/* Select mode for lists: tap rows to pick them, then remove them together (one Undo).
   Only rows still shown count, so changing a filter never removes something out of sight. */
import { useEffect, useState } from "react";
import { removeMany } from "../state/actions";
import { IconClose, IconTrash } from "./Icons";

export interface Selection {
  on: boolean;
  has: (path: string) => boolean;
  toggle: (path: string) => void;
  start: () => void;
  stop: () => void;
  all: () => void;
  none: () => void;
  picked: string[];
  shown: number;
}

export function useSelection(shown: string[]): Selection {
  const [on, setOn] = useState(false);
  const [set, setSet] = useState<Set<string>>(() => new Set());
  const picked = shown.filter((p) => set.has(p));
  const stop = () => { setOn(false); setSet(new Set()); };

  useEffect(() => {
    if (!on) return;
    document.documentElement.classList.add("selecting");
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) stop(); };
    window.addEventListener("keydown", key);
    return () => { document.documentElement.classList.remove("selecting"); window.removeEventListener("keydown", key); };
  }, [on]);

  return {
    on, picked, shown: shown.length,
    has: (p) => set.has(p),
    toggle: (p) => setSet((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; }),
    start: () => setOn(true),
    stop,
    all: () => setSet(new Set(shown)),
    none: () => setSet(new Set()),
  };
}

/** The "Select" button for a page head; becomes "Cancel" while selecting. */
export function SelectButton({ sel }: { sel: Selection }) {
  if (!sel.shown && !sel.on) return null;
  return (
    <button type="button" className="btn ghost sm" aria-pressed={sel.on} onClick={sel.on ? sel.stop : sel.start}>
      {sel.on ? "Cancel" : "Select"}
    </button>
  );
}

/** The bar along the bottom while selecting. */
export function SelectBar({ sel, what = "items" }: { sel: Selection; what?: string }) {
  if (!sel.on) return null;
  const n = sel.picked.length;
  const every = n > 0 && n === sel.shown;
  return (
    <div className="select-bar" role="toolbar" aria-label="Selected items">
      <button type="button" className="icon-btn" onClick={sel.stop} aria-label="Stop selecting"><IconClose /></button>
      <span className="grow" aria-live="polite">{n ? `${n} selected` : `Tap ${what} to select them`}</span>
      <button type="button" className="btn ghost sm" onClick={every ? sel.none : sel.all}>{every ? "None" : "All"}</button>
      <button type="button" className="btn danger sm" disabled={!n} onClick={() => { removeMany(sel.picked); sel.stop(); }}>
        <IconTrash /> Delete
      </button>
    </div>
  );
}
