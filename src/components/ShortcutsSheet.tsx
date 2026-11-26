/* Every keyboard shortcut in the app and every slash command, in one sheet (sheet `{ kind: "shortcuts" }`): from the
   ? key, /shortcuts in a note, or Vault & settings. The editor's keys and the slash commands come from their own
   lists (editor/commands.ts EDITOR_KEYS, editor/slash.ts SLASH), so this stays in step with them. */
import { EDITOR_KEYS } from "./editor/commands";
import { SLASH } from "./editor/slash";
import { Sheet } from "./ui";

const APP_KEYS: { keys: string; what: string }[] = [
  { keys: "⌘K or /", what: "Search everything" },
  { keys: "N", what: "Add something (the + sheet)" },
  { keys: "?", what: "These shortcuts" },
  { keys: "Esc", what: "Close a sheet or menu; leave select mode" },
  { keys: "↑ ↓ ↩", what: "In search: move through the results and open one" },
  { keys: "⌘↩", what: "In a form with a big text box (Ask Claude): send" },
];
const SKETCH_KEYS: { keys: string; what: string }[] = [
  { keys: "⌘Z / ⌘⇧Z", what: "Undo / redo a stroke" },
  { keys: "⌫", what: "Delete the lassoed strokes" },
  { keys: "Esc", what: "Let go of the selection" },
];
const CARD_KEYS: { keys: string; what: string }[] = [
  { keys: "Space or ↩", what: "Show the answer" },
  { keys: "1 2 3 4", what: "Again, Hard, Good, Easy" },
];
const COOK_KEYS: { keys: string; what: string }[] = [
  { keys: "→ or Space", what: "Next step" },
  { keys: "←", what: "Previous step" },
];

function KeyTable({ rows }: { rows: { keys: string; what: string }[] }) {
  return (
    <dl className="keys">
      {rows.map((r) => (
        <div key={r.keys + r.what} className="key-row">
          <dt>{r.keys.split(/( or | \/ )/).map((k, i) => (/^( or | \/ )$/.test(k) ? <span key={i} className="muted"> {k.trim()} </span> : <kbd key={i}>{k}</kbd>))}</dt>
          <dd>{r.what}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const groups = [...new Set(SLASH.map((c) => c.group))];
  return (
    <Sheet title="Shortcuts and slash commands" onClose={onClose} wide>
      <p className="muted small">On a Mac keyboard ⌘ is Command; with another keyboard use Ctrl. On the iPhone and iPad the bar above the keyboard has the same tools.</p>
      <section className="dlg-section" aria-labelledby="k-app"><h3 id="k-app">Anywhere</h3><KeyTable rows={APP_KEYS} /></section>
      <section className="dlg-section" aria-labelledby="k-ed"><h3 id="k-ed">Writing a note</h3><KeyTable rows={EDITOR_KEYS} /></section>
      <section className="dlg-section" aria-labelledby="k-slash">
        <h3 id="k-slash">Slash commands</h3>
        <p className="muted small">Type / at the start of a line or after a space, then a few letters. Your templates (the Templates folder, and the starters) are there too, by name.</p>
        {groups.map((g) => (
          <div key={g} className="slash-group">
            <h4>{g}</h4>
            <dl className="keys">
              {SLASH.filter((c) => c.group === g).map((c) => (
                <div key={c.names[0]} className="key-row">
                  <dt><kbd>/{c.names[0]}</kbd>{c.names.length > 1 && <span className="muted small"> {c.names.slice(1).map((n) => "/" + n).join(" ")}</span>}</dt>
                  <dd><b>{c.title}</b> <span className="muted">{c.hint}</span></dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </section>
      <section className="dlg-section" aria-labelledby="k-sk"><h3 id="k-sk">Drawing</h3><KeyTable rows={SKETCH_KEYS} /></section>
      <section className="dlg-section" aria-labelledby="k-cards"><h3 id="k-cards">Flashcards</h3><KeyTable rows={CARD_KEYS} /></section>
      <section className="dlg-section" aria-labelledby="k-cook"><h3 id="k-cook">Cook mode</h3><KeyTable rows={COOK_KEYS} /></section>
    </Sheet>
  );
}
