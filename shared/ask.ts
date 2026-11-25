/* /ask in a note: a question to Claude about the note, answered through the vault's Action (like Explore).
   The app writes `.hub/requests/ask-<id>.json` { kind: "ask", note, question, at } and puts a waiting callout in the
   note, ending in the block id ^ask-<id>; the enricher answers in the request (`answer` or `error`); the app then
   swaps the callout for the answer and removes the request. All plain Markdown: Obsidian shows the callouts too.
   DOM- and Node-free. */

export const ASK_PREFIX = ".hub/requests/ask-";
export const askPath = (id: string) => `${ASK_PREFIX}${id}.json`;
export interface AskRequest { kind: "ask"; note: string; question: string; at: string; answer?: string; error?: string; model?: string }

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const quoted = (text: string) => text.trim().split("\n").map((l) => (l.trim() ? `> ${l}` : ">")).join("\n");

/** The callout that waits for the answer. */
export const waitingBlock = (id: string, question: string) =>
  `> [!question] Asked Claude: ${oneLine(question)}\n> Waiting for the answer… ^ask-${id}`;

/** The answer, as a callout under the question. */
export const answerBlock = (question: string, answer: string) =>
  `> [!info] Claude: ${oneLine(question)}\n${quoted(answer)}`;

/** The body with the waiting callout for `id` replaced by `block`; null if the callout isn't there any more. */
export function replaceWaiting(body: string, id: string, block: string): string | null {
  const lines = body.split("\n");
  const end = lines.findIndex((l) => l.trimEnd().endsWith(`^ask-${id}`));
  if (end < 0) return null;
  let start = end;
  while (start > 0 && lines[start - 1].startsWith(">") && !/^>\s*\[!question\] Asked Claude:/.test(lines[start])) start--;
  return [...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end + 1)].join("\n");
}
