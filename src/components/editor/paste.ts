/* Pasting a web address: over selected text it becomes [text](url); on its own it goes in as it is, and a toast
   offers to save it as a link (the + sheet with it filled in, so it gets a title and summary in Resources). */
import { EditorView } from "@codemirror/view";
import { isHttpUrl } from "../../../shared/vault.ts";
import { openSheet } from "../../lib/sheets";
import { showToast } from "../../lib/toast";

export const pasteLinks = EditorView.domEventHandlers({
  paste(e, view) {
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (!text || !isHttpUrl(text) || /\s/.test(text)) return false;
    const r = view.state.selection.main;
    if (!r.empty) {
      const sel = view.state.sliceDoc(r.from, r.to);
      if (isHttpUrl(sel.trim())) return false;
      e.preventDefault();
      const insert = `[${sel}](${text})`;
      view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: { anchor: r.from + insert.length }, userEvent: "input.paste" });
      return true;
    }
    // a bare link: pasted as usual, and an offer to save it
    setTimeout(() => showToast("Pasted a link", { label: "Save as link", run: () => openSheet({ kind: "capture", init: { url: text } }) }), 0);
    return false;
  },
});
