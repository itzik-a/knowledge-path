/* /ask on this device (shared/ask.ts has the format): send a question about a note, and when an answer (or an error)
   comes back from the vault's Action, put it in the note in place of the waiting callout and remove the request.
   Two devices doing that at once write the same text, which merges cleanly. Locked notes are never asked about. */
import { ASK_PREFIX, answerBlock, askPath, replaceWaiting, waitingBlock, type AskRequest } from "../../shared/ask.ts";
import { splitFrontmatter } from "../../shared/vault.ts";
import { insertInEditor } from "../lib/insert";
import { showToast } from "../lib/toast";
import { setBodyOf } from "./actions";
import { allRecords, readFile, removeFile, subscribe, writeFiles } from "./store";

/** Ask Claude about a note; the waiting callout goes in at the editor's cursor (else at the end). False for a locked note. */
export function requestAsk(path: string, question: string): boolean {
  const c = readFile(path);
  if (c == null || !question.trim()) return false;
  if (splitFrontmatter(c).fm.private === true) { showToast("Locked notes aren't sent to Claude"); return false; }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const req: AskRequest = { kind: "ask", note: path, question: question.trim(), at: new Date().toISOString() };
  writeFiles([{ path: askPath(id), content: JSON.stringify(req, null, 2) + "\n" }]);
  const block = waitingBlock(id, question);
  if (!insertInEditor(path, block)) {
    const body = splitFrontmatter(readFile(path) ?? "").body;
    setBodyOf(path, `${body.trimEnd()}${body.trim() ? "\n\n" : ""}${block}\n`);
  }
  showToast("Asked Claude: the answer comes in a minute or two, once the vault syncs");
  return true;
}

/** Swap answered requests into their notes. */
function settle() {
  for (const r of allRecords()) {
    if (r.deleted || !r.path.startsWith(ASK_PREFIX) || !r.path.endsWith(".json")) continue;
    let a: AskRequest;
    try { a = JSON.parse(r.content) as AskRequest; } catch { continue; }
    if (!a.answer && !a.error) continue;
    const id = r.path.slice(ASK_PREFIX.length, -".json".length);
    const c = readFile(a.note);
    const body = c != null ? splitFrontmatter(c).body : undefined;
    const block = a.answer ? answerBlock(a.question, a.answer) : `> [!warning] Claude couldn't answer: ${a.question.replace(/\s+/g, " ")}\n> ${a.error}`;
    const next = body != null ? replaceWaiting(body, id, block) : null;
    if (next != null && next !== body) setBodyOf(a.note, next);
    removeFile(r.path); // answered (or the note or its callout is gone): the request is done
  }
}

let started = false;
/** Watch for answers (main.tsx, once the vault has loaded). */
export function startAsks() {
  if (started) return;
  started = true;
  let busy = false;
  const run = () => { if (busy) return; busy = true; try { settle(); } finally { busy = false; } };
  run();
  subscribe(run);
}
