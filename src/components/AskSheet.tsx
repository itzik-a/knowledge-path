/* /ask: a question to Claude about the note (sheet `{ kind: "ask", path }`). Sent through the vault's Action
   (src/state/ask.ts); the answer replaces the waiting callout in the note when it comes back. */
import { useRef, useState, type FormEvent } from "react";
import { requestAsk } from "../state/ask";
import { getConfig } from "../state/sync";
import { useIndex } from "../state/store";
import { Sheet, closeSheet } from "./ui";

export function AskSheet({ path, onClose }: { path: string; onClose: () => void }) {
  const d = useIndex().docs.get(path);
  const [q, setQ] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const connected = !!getConfig();
  function send(e: FormEvent) {
    e.preventDefault();
    if (requestAsk(path, q)) closeSheet(form.current);
  }
  return (
    <Sheet title="Ask Claude about this note" onClose={onClose}>
      <form ref={form} className="form-grid" onSubmit={send}>
        <p className="muted small" dir="auto">Claude (Opus) reads <b>{d?.title ?? "the note"}</b> and answers in a box where your cursor is. It goes through your vault on GitHub, so it takes a minute or two.</p>
        {!connected && <p className="form-error">Connect the vault first (Vault & settings): the question is answered there.</p>}
        <textarea className="text-input" dir="auto" rows={3} data-autofocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. What's the strongest objection to this?" aria-label="Your question"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.current?.requestSubmit(); }} />
        <button className="btn primary" type="submit" disabled={!q.trim() || !connected || d?.private}>Ask</button>
        {d?.private && <p className="muted small">Locked notes aren't sent to Claude.</p>}
      </form>
    </Sheet>
  );
}
