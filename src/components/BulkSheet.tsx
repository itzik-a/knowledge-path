/* The choices for a bulk action on selected items: a status, a topic to add or remove, a study path to make or
   add to, or a folder to move notes into. */
import { useState } from "react";
import { STATUSES, type Status } from "../../shared/vault.ts";
import { bulkMove, bulkStatus, bulkToPath, bulkTopic, noteFolders } from "../state/bulk";
import { useIndex } from "../state/store";
import { docHref, go } from "../lib/route";
import { STATUS_LABEL } from "./bits";
import { Field, Sheet } from "./ui";

export type BulkMode = "status" | "topic-add" | "topic-remove" | "path" | "folder";

export function BulkSheet({ mode, paths, onDone, onClose }: { mode: BulkMode; paths: string[]; onDone: () => void; onClose: () => void }) {
  const ix = useIndex();
  const n = paths.length;
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const finish = (changed: unknown) => { if (changed) onDone(); else onClose(); };

  if (mode === "status") {
    return (
      <Sheet title={`Set the status of ${n}`} onClose={onClose}>
        <div className="bulk-list">
          {STATUSES.map((s: Status) => <button key={s} type="button" className="bulk-choice" onClick={() => finish(bulkStatus(paths, s))}>{STATUS_LABEL[s]}</button>)}
        </div>
      </Sheet>
    );
  }

  if (mode === "topic-add" || mode === "topic-remove") {
    const add = mode === "topic-add";
    const ids = add ? ix.topicOrder : ix.topicOrder.filter((id) => paths.some((p) => (ix.topicsOf.get(p) ?? []).includes(id)));
    return (
      <Sheet title={add ? `Add a topic to ${n}` : `Remove a topic from ${n}`} onClose={onClose}>
        {!add && <p className="muted small">Only the topics in their Topics property can be removed here; a link or tag in the text keeps an item in its topic.</p>}
        <div className="bulk-list">
          {ids.map((id) => {
            const t = ix.topics.get(id)!;
            return (
              <button key={id} type="button" className="bulk-choice" style={{ paddingInlineStart: 14 + t.depth * 18 }} onClick={() => finish(bulkTopic(paths, id, add))}>
                {t.icon && <span aria-hidden="true">{t.icon} </span>}<span dir="auto">{t.name}</span>
              </button>
            );
          })}
          {!ids.length && <p className="muted">None of them has a topic to remove.</p>}
        </div>
      </Sheet>
    );
  }

  if (mode === "path") {
    const existing = [...ix.docs.values()].filter((d) => d.kind === "path").sort((a, b) => a.title.localeCompare(b.title));
    const make = () => { const f = bulkToPath(paths, { title }); if (f) { onDone(); go(docHref(f)); } };
    return (
      <Sheet title={`Make a study path from ${n}`} onClose={onClose}>
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); make(); }}>
          <Field label="New study path">
            <input className="text-input" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Its name" dir="auto" />
          </Field>
          <p className="muted small">One step for each, in the list's order. You can reorder and add notes to the steps afterwards.</p>
          <div className="btn-row"><button type="submit" className="btn primary" disabled={!title.trim()}>Make it</button></div>
        </form>
        {existing.length > 0 && (
          <>
            <h3 className="bulk-sub">Or add them to</h3>
            <div className="bulk-list">
              {existing.map((d) => <button key={d.path} type="button" className="bulk-choice" onClick={() => finish(bulkToPath(paths, { path: d.path }))}><span dir="auto">{d.title}</span></button>)}
            </div>
          </>
        )}
      </Sheet>
    );
  }

  // folder
  const folders = noteFolders();
  return (
    <Sheet title={`Move ${n} to a folder`} onClose={onClose}>
      <div className="bulk-list">
        {folders.map((f) => <button key={f || "/"} type="button" className="bulk-choice" onClick={() => finish(bulkMove(paths, f))}><span dir="auto">{f || "Top of the vault"}</span></button>)}
      </div>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); if (folder.trim()) finish(bulkMove(paths, folder.trim())); }}>
        <Field label="A new folder">
          <input className="text-input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Notes/Ideas" dir="auto" />
        </Field>
        <div className="btn-row"><button type="submit" className="btn primary" disabled={!folder.trim()}>Move them there</button></div>
      </form>
    </Sheet>
  );
}
