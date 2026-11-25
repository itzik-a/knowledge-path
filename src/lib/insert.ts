/* The note editor that's open, so something outside it can reach it: a new sketch put in at the cursor, the outline
   moving the cursor to a heading. */
type Insert = (text: string) => void;
type Goto = (line: number) => void;

const open = new Map<string, Insert>();
const gotos = new Map<string, Goto>();

/** Called by NoteBody when its editor mounts (with a function) and unmounts (with null). */
export function registerEditor(path: string, insert: Insert | null) {
  if (insert) open.set(path, insert); else open.delete(path);
}
export function registerGoto(path: string, goto: Goto | null) {
  if (goto) gotos.set(path, goto); else gotos.delete(path);
}

/** Put text in the open editor of this note, on its own line at the cursor. False if it isn't open. */
export function insertInEditor(path: string, text: string): boolean {
  const f = open.get(path);
  if (!f) return false;
  f(text);
  return true;
}

/** Move the open editor's cursor to a line (0-based) of the body, at the top of the view. False if it isn't open. */
export function gotoInEditor(path: string, line: number): boolean {
  const f = gotos.get(path);
  if (!f) return false;
  f(line);
  return true;
}
