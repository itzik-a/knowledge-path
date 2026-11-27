/* A file's body: rendered for reading, or the editor. Saves as I type; a file that doesn't exist yet
   (today's journal entry) is created by the first keystroke. */
import { registerEditor, registerGoto } from "../lib/insert";
import { WordCount } from "./editor/outline";
import { setBodyOf, toggleStep } from "../state/actions";
import { exists, writeFile } from "../state/store";
import { Suspense } from "react";
import { lazyPart } from "../lib/lazy";
import { Markdown } from "./Markdown";

// CodeMirror is most of the app's code: load it the first time something is edited.
const Editor = lazyPart(() => import("./Editor").then((m) => ({ default: m.Editor })));

/** The body without its "## Highlights" section (blank lines in its place, so line numbers still match). */
export function withoutHighlights(body: string): string {
  const lines = body.split("\n");
  const h = lines.findIndex((l) => /^##\s+highlights\s*$/i.test(l.trim()));
  if (h < 0) return body;
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) { end = i; break; }
  for (let i = h; i < end; i++) lines[i] = "";
  return lines.join("\n");
}

export function NoteBody({ path, body, editing, placeholder, empty, autoFocus, hideHighlights, onBlur, newFile }: {
  path: string; body: string; editing: boolean; placeholder?: string; empty?: string; autoFocus?: boolean; hideHighlights?: boolean; onBlur?: () => void;
  /** How to create the file if it doesn't exist yet (default: just the body). */
  newFile?: (body: string) => string;
}) {
  const write = (b: string) => {
    if (exists(path)) setBodyOf(path, b, { lazy: true });
    else if (b.trim()) writeFile(path, newFile ? newFile(b) : b);
  };
  if (editing) {
    return (
      <Suspense fallback={<div className="editor loading" aria-busy="true" />}>
        <Editor value={body} onChange={write} placeholder={placeholder} autoFocus={autoFocus} onBlur={onBlur} path={path}
          onInsertReady={(insert) => registerEditor(path, insert)} onGotoReady={(g) => registerGoto(path, g)} />
        <WordCount body={body} />
      </Suspense>
    );
  }
  return <Markdown body={hideHighlights ? withoutHighlights(body) : body} from={path} onToggle={(line) => toggleStep(path, line)} empty={empty} />;
}
