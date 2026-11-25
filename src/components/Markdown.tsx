/* A note body rendered for reading. [[Links]] go to their page; a link to a note that doesn't exist yet
   creates it; ticking a checkbox changes the line in the file. */
import { useMemo, type MouseEvent } from "react";
import { resolve } from "../../shared/index.ts";
import { isLockedName } from "../../shared/private.ts";
import { renderMarkdown, sectionOf } from "../lib/markdown";
import { docHref, go } from "../lib/route";
import { openSheet } from "../lib/sheets";
import { findSketch } from "../state/sketches";
import { createNote } from "../state/actions";
import { readFile, useIndex } from "../state/store";

export function Markdown({ body, from, onToggle, className, empty }: { body: string; from?: string; onToggle?: (line: number) => void; className?: string; empty?: string }) {
  const ix = useIndex();
  const html = useMemo(() => renderMarkdown(body, {
    resolve: (t) => resolve(ix, t, from),
    title: (p) => { const d = ix.docs.get(p); return d && isLockedName(d.name) ? d.title : undefined; },
    sketch: (t) => { const p = findSketch(t); const svg = p ? readFile(p) : undefined; return p && svg != null ? { path: p, svg } : undefined; },
    embed: (t, heading) => {
      const p = resolve(ix, t, from);
      const d = p ? ix.docs.get(p) : undefined;
      if (!d || d.sealed || d.kind === "hub") return undefined;
      const text = heading ? sectionOf(d.body, heading) : d.body;
      return text == null ? undefined : { path: d.path, title: d.title, body: text };
    },
    self: from,
  }), [body, ix, from]);
  if (!body.trim()) return empty ? <p className="muted small">{empty}</p> : null;

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement && el.classList.contains("task-box")) {
      if (!onToggle) { e.preventDefault(); return; }
      onToggle(Number(el.dataset.line));
      return;
    }
    const sk = el.closest<HTMLElement>("[data-sketch]");
    if (sk?.dataset.sketch) { openSheet({ kind: "sketch", path: sk.dataset.sketch, note: from }); return; }
    const a = el.closest("a");
    const create = a?.getAttribute("data-create");
    if (create) {
      e.preventDefault();
      const name = create.split("/").pop()!;
      go(docHref(createNote({ title: name, folder: create.includes("/") ? create.slice(0, create.lastIndexOf("/")) : undefined })));
    }
  }

  return <div className={`prose ${className ?? ""}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
