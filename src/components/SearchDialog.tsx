/* Search everything (⌘K, or the magnifier): topics by name, then every file by title, author, tags and text. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { search, snippet } from "../lib/search";
import { docHref, go, topicHref } from "../lib/route";
import { useIndex } from "../state/store";
import { topicColor, TYPE_EMOJI } from "./bits";
import { IconSearch } from "./Icons";
import { shortDate } from "../lib/dates";

interface Hit { key: string; href: string; icon: ReactNode; title: string; sub?: string }

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const ix = useIndex();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.showModal();
    input.current?.focus();
    document.documentElement.classList.add("sheet-open");
    return () => document.documentElement.classList.remove("sheet-open");
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const topics: Hit[] = ix.topicOrder.map((id) => ix.topics.get(id)!).filter((t) => t.name.toLowerCase().includes(s)).slice(0, 5).map((t) => ({
      key: "t:" + t.id, href: topicHref(t.id), title: t.name, sub: t.parent ? ix.topics.get(t.parent)?.name : "Topic",
      icon: <span className="swatch" style={{ background: topicColor(t) }} />,
    }));
    const docs: Hit[] = search(ix, q, 30).filter((d) => d.kind !== "topic").map((d) => ({
      key: d.path, href: docHref(d.path),
      title: d.kind === "journal" && d.date ? `Journal · ${shortDate(d.date)}` : d.title,
      sub: d.resource ? [d.resource.author, snippet(d.body, q, 90) || d.resource.summary].filter(Boolean).join(" · ") : snippet(d.body, q),
      icon: <span aria-hidden="true">{d.resource ? TYPE_EMOJI[d.resource.type] : d.kind === "journal" ? "📓" : d.kind === "path" ? "🧭" : d.kind === "habit" ? d.habit?.icon ?? "🔁" : d.kind === "recipe" ? "🍲" : "📝"}</span>,
    }));
    return [...topics, ...docs];
  }, [ix, q]);

  useEffect(() => { setSel(0); }, [q]);

  const open = (h?: Hit) => { if (!h) return; ref.current?.close(); go(h.href); };
  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); open(hits[sel]); }
    // A search field takes Esc for itself (clearing it), so the dialog never sees it: close here.
    else if (e.key === "Escape") { e.preventDefault(); ref.current?.close(); }
  }

  return (
    <dialog ref={ref} className="dlg search-dlg" aria-label="Search" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="search-dlg-body">
        <label className="search big">
          <IconSearch />
          <input ref={input} type="search" dir="auto" placeholder="Search topics, resources, notes, journal" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            aria-label="Search" aria-controls="search-results" aria-activedescendant={hits[sel] ? `sr-${sel}` : undefined} enterKeyHint="go" />
          <button type="button" className="btn ghost sm" onClick={() => ref.current?.close()}>Cancel</button>
        </label>
        <ul id="search-results" className="search-results" role="listbox">
          {hits.map((h, i) => (
            <li key={h.key} id={`sr-${i}`} role="option" aria-selected={i === sel}>
              <a href={h.href} onClick={(e) => { e.preventDefault(); open(h); }} onMouseEnter={() => setSel(i)}>
                <span className="sr-icon">{h.icon}</span>
                <span className="item-main">
                  <span className="item-title" dir="auto">{h.title}</span>
                  {h.sub && <span className="item-meta clamp" dir="auto">{h.sub}</span>}
                </span>
              </a>
            </li>
          ))}
          {q.trim() && !hits.length && <li className="muted pad">Nothing found for “{q}”.</li>}
          {!q.trim() && <li className="muted small pad">Searches titles, authors, tags and the full text of every note, on this device.</li>}
        </ul>
      </div>
    </dialog>
  );
}
