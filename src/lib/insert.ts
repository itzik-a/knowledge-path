/* The note editor that's open, so something outside it (a new sketch) can be put in at the cursor. */
type Insert = (text: string) => void;

const open = new Map<string, Insert>();

/** Called by NoteBody when its editor mounts (with a function) and unmounts (with null). */
export function registerEditor(path: string, insert: Insert | null) {
  if (insert) open.set(path, insert); else open.delete(path);
}

/** Put text in the open editor of this note, on its own line at the cursor. False if it isn't open. */
export function insertInEditor(path: string, text: string): boolean {
  const f = open.get(path);
  if (!f) return false;
  f(text);
  return true;
}
