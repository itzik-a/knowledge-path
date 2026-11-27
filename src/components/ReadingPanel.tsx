/* The Aa button and its panel, like a Kindle's: theme, font, text size, line spacing, alignment and page width, all for this
   device (src/lib/reading.ts, src/lib/theme.ts). Not modal: each choice shows on the page behind at once. From 768 px it's a
   popover by the button; below, a panel along the bottom of the screen. Esc or a tap outside closes it. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ALIGNS, FONTS, SIZES, SPACINGS, WIDTHS, isDefaultReading, resetReading, setReading, useReading } from "../lib/reading";
import { setTheme, useTheme } from "../lib/theme";
import { THEMES } from "./ThemePicker";
import { Seg, useMedia } from "./ui";

const PANEL_W = 340;

export function ReadingButton({ className = "icon-btn subtle" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" className={`${className} aa-btn`} aria-label="Text and page" title="Text and page" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">A<small>a</small></span>
      </button>
      {open && <ReadingPanel anchor={btn} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReadingPanel({ anchor, onClose }: { anchor: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const r = useReading();
  const theme = useTheme();
  const big = useMedia("(min-width: 768px)");
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });

  // by the button: below it, or above when there's no room; inside the window
  useLayoutEffect(() => {
    if (!big) return setPlace({});
    const at = () => {
      const b = anchor.current?.getBoundingClientRect(), h = panel.current?.offsetHeight ?? 0;
      if (!b) return;
      const left = Math.max(8, Math.min(b.left, innerWidth - PANEL_W - 8));
      const below = b.bottom + 8 + h <= innerHeight - 8;
      setPlace(below ? { left, top: b.bottom + 8 } : { left, top: Math.max(8, b.top - 8 - h) });
    };
    at();
    addEventListener("resize", at);
    return () => removeEventListener("resize", at);
  }, [big, anchor]);

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const off = (e: Event) => { const t = e.target as Node; if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); anchor.current?.focus(); } };
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc, true); };
  }, [onClose, anchor]);

  const size = SIZES[r.size];
  return createPortal(
    <div ref={panel} className={`read-panel${big ? "" : " bottom"}`} style={place} role="dialog" aria-label="Text and page" tabIndex={-1}>
      <div className="read-themes" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className="read-theme" onClick={() => setTheme(t.id)}>
            <span className={`read-theme-chip t-${t.id}`} aria-hidden="true"><span>Aa</span></span>
            <span className="read-theme-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="read-fonts" role="radiogroup" aria-label="Font">
        {FONTS.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={r.font === f.id} className={`read-font ff-${f.id}`} onClick={() => setReading({ font: f.id })}>{f.label}</button>
        ))}
      </div>

      <div className="read-size" role="group" aria-label="Text size">
        <button type="button" className="read-step" aria-label="Smaller text" disabled={r.size === 0} onClick={() => setReading({ size: r.size - 1 })}><span className="aa-small">A</span></button>
        <div className="read-dots" aria-hidden="true">
          {SIZES.map((s, i) => <span key={s} className={i <= r.size ? "on" : undefined} />)}
        </div>
        <span className="read-size-val" aria-live="polite">{size} px</span>
        <button type="button" className="read-step" aria-label="Larger text" disabled={r.size === SIZES.length - 1} onClick={() => setReading({ size: r.size + 1 })}><span className="aa-big">A</span></button>
      </div>

      <div className="read-row">
        <span className="eyebrow">Line spacing</span>
        <Seg value={r.spacing} options={SPACINGS} onChange={(spacing) => setReading({ spacing })} label="Line spacing" />
      </div>
      <div className="read-row">
        <span className="eyebrow">Alignment</span>
        <Seg value={r.align} options={ALIGNS} onChange={(align) => setReading({ align })} label="Alignment" />
      </div>
      {big && (
        <div className="read-row">
          <span className="eyebrow">Page width</span>
          <Seg value={r.width} options={WIDTHS} onChange={(width) => setReading({ width })} label="Page width" />
        </div>
      )}

      <div className="read-foot">
        <span className="muted small">For this device</span>
        <button type="button" className="text-btn" disabled={isDefaultReading(r)} onClick={resetReading}>Reset</button>
      </div>
    </div>,
    document.body,
  );
}
