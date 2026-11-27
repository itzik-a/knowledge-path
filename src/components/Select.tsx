/* Select mode for lists: tap rows to pick them, then act on them together (one Undo): delete, or the bulk actions
   in the bar's menu (src/state/bulk.ts).
   Only rows still shown count, so changing a filter never removes something out of sight. */
import { useEffect, useState } from "react";
import { inbox } from "../../shared/index.ts";
import { deleteDocs } from "../state/actions";
import { bulkCopy, bulkKeepOut, bulkKinds, bulkLock, bulkPin } from "../state/bulk";
import { getIndex } from "../state/store";
import { BulkSheet, type BulkMode } from "./BulkSheet";
import { IconClose, IconMore, IconTrash } from "./Icons";
import { Menu } from "./ui";

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

/** The actions for what's selected: only the ones that fit every selected item. */
function bulkItems(picked: string[], open: (m: BulkMode) => void, done: () => void) {
  const k = bulkKinds(picked);
  const ix = getIndex();
  const docs = picked.map((p) => ix.docs.get(p));
  const allPinned = docs.every((d) => d?.pinned);
  const allLocked = docs.every((d) => d?.private);
  const inInbox = new Set(inbox(ix).map((d) => d.path));
  const run = (f: () => unknown) => () => { void Promise.resolve(f()).then(done); };
  return [
    k.resources && { label: "Set status…", run: () => open("status") },
    k.topical && { label: "Add a topic…", run: () => open("topic-add") },
    k.topical && { label: "Remove a topic…", run: () => open("topic-remove") },
    picked.every((p) => inInbox.has(p)) && { label: "Keep without a topic", run: run(() => bulkKeepOut(picked)) },
    { label: "Make a study path…", run: () => open("path") },
    { label: allPinned ? "Unpin" : "Pin", run: run(() => bulkPin(picked, !allPinned)) },
    k.lockable && { label: allLocked ? "Unlock" : "Lock", run: run(() => bulkLock(picked, !allLocked)) },
    k.movable && { label: "Move to folder…", run: () => open("folder") },
    { label: "Copy as [[links]]", run: run(() => bulkCopy(picked, "links")) },
    { label: "Copy titles and web links", run: run(() => bulkCopy(picked, "urls")) },
  ];
}

/** The bar along the bottom while selecting. */
export function SelectBar({ sel }: { sel: Selection }) {
  const [mode, setMode] = useState<BulkMode | null>(null);
  if (!sel.on) return null;
  const n = sel.picked.length;
  const every = n > 0 && n === sel.shown;
  return (
    <div className="select-bar" role="toolbar" aria-label="Selected items">
      <button type="button" className="icon-btn" onClick={sel.stop} aria-label="Stop selecting"><IconClose /></button>
      <span className="grow" aria-live="polite">{n ? `${n} selected` : "Tap to select"}</span>
      <button type="button" className="btn ghost sm" onClick={every ? sel.none : sel.all}>{every ? "None" : "All"}</button>
      {n > 0 && <Menu label="Actions for the selected items" icon={<IconMore />} up items={bulkItems(sel.picked, setMode, sel.stop)} />}
      {mode && <BulkSheet mode={mode} paths={sel.picked} onDone={() => { setMode(null); sel.stop(); }} onClose={() => setMode(null)} />}
      <button type="button" className="btn danger sm" disabled={!n} onClick={async () => { if (await deleteDocs(sel.picked)) sel.stop(); }}>
        <IconTrash /> Delete
      </button>
    </div>
  );
}
