/* A text selection that a button acts on (Highlight in the article, chapter and PDF readers).
   On a touch screen the tap on the button clears the selection before the tap lands (iOS collapses it at
   touchstart; preventDefault doesn't stop that), so the button vanished under the finger and the tap was lost.
   So: the last selection is held, and the button stays for a moment after the selection goes; a press on it
   keeps it, and it acts on pointer up (iOS may drop the click), the click covering the keyboard. */
import { useEffect, useRef, useState, type RefObject } from "react";

export function useHeldSelection<T>(box: RefObject<HTMLElement | null>, read: (s: Selection) => T | null) {
  const [sel, setSel] = useState<T | null>(null);
  const held = useRef<T | null>(null);
  const pressing = useRef(false);
  const timer = useRef(0);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    const on = () => {
      const s = document.getSelection();
      const v = s && !s.isCollapsed && box.current?.contains(s.anchorNode) ? readRef.current(s) : null;
      clearTimeout(timer.current);
      if (v) { held.current = v; setSel(v); return; }
      // gone: wait a moment, so a tap on the button still finds it
      timer.current = window.setTimeout(() => { if (!pressing.current) { held.current = null; setSel(null); } }, 600);
    };
    // a press that started on the button but ended elsewhere (the finger slid off) lets go too
    const up = () => setTimeout(() => { pressing.current = false; }, 0);
    document.addEventListener("selectionchange", on);
    document.addEventListener("pointerup", up);
    return () => { document.removeEventListener("selectionchange", on); document.removeEventListener("pointerup", up); clearTimeout(timer.current); };
  }, [box]);

  const clear = () => {
    clearTimeout(timer.current);
    pressing.current = false;
    held.current = null;
    setSel(null);
    document.getSelection()?.removeAllRanges();
  };

  /** Props for the button: `act` gets the held selection once per press. */
  const buttonProps = (act: (v: T) => void) => {
    let fired = 0;
    const run = () => {
      const v = held.current;
      if (!v || Date.now() - fired < 500) return;
      fired = Date.now();
      act(v);
      clear();
    };
    return {
      onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); pressing.current = true; },
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onPointerUp: () => run(),
      onPointerCancel: () => { pressing.current = false; },
      onClick: () => run(),
    };
  };

  return { sel, clear, buttonProps };
}
