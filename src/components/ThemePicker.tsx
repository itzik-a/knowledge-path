/* System / Light / Sepia / Dark for this device (src/lib/theme.ts), and the accent for every device (src/state/appearance.ts). */
import { setTheme, useTheme, type Theme } from "../lib/theme";
import { ACCENTS, setAccent, useAccent } from "../state/appearance";
import { IconCheck } from "./Icons";

export const THEMES: { id: Theme; label: string }[] = [{ id: "system", label: "System" }, { id: "light", label: "Light" }, { id: "sepia", label: "Sepia" }, { id: "dark", label: "Dark" }];

export function ThemePicker() {
  const theme = useTheme();
  return (
    <div className="seg theme-seg" role="group" aria-label="Theme">
      {THEMES.map((o) => (
        <button key={o.id} type="button" aria-pressed={theme === o.id} onClick={() => setTheme(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/** One swatch per accent, in this mode's colour (the swatches are the presets' own values, not tokens). */
export function AccentPicker() {
  useTheme(); // re-render when light / dark changes
  const accent = useAccent();
  const dark = document.documentElement.dataset.theme === "dark";
  const chosen = ACCENTS.find((a) => a.id === accent)!;
  return (
    <div className="accent-row">
      <div className="accent-picks" role="radiogroup" aria-label="Accent colour">
        {ACCENTS.map((a) => {
          const sw = dark ? a.dark : a.light;
          return (
            <button key={a.id} type="button" role="radio" aria-checked={a.id === accent} aria-label={a.name} title={a.name} className="accent-pick" onClick={() => setAccent(a.id)}>
              <span className={a.bg ? "split" : undefined} style={{ background: a.bg ? undefined : sw, "--sw": sw, "--sw2": dark ? "#3A3B41" : "#D9DADF", color: dark ? a.onDark : "#FFFFFF" } as React.CSSProperties}>
                {a.id === accent && <IconCheck />}
              </span>
            </button>
          );
        })}
      </div>
      <p className="accent-name">{chosen.name}</p>
    </div>
  );
}
