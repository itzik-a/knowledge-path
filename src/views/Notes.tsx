/* #notes: notes by folder, newest first. #notes/journal: the journal, a month at a time. #tag/<tag>: everything with a tag. */
import { useMemo, useState } from "react";
import type { Doc } from "../../shared/index.ts";
import { journalPath, todayISO } from "../../shared/vault.ts";
import { DocRow, NoteRow } from "../components/bits";
import { IconBack, IconClose, IconNext, IconPlus, IconSearch } from "../components/Icons";
import { SelectBar, SelectButton, useSelection, type Selection } from "../components/Select";
import { Seg } from "../components/ui";
import { iso, monthName, parseISO, shortDate } from "../lib/dates";
import { docHref, go } from "../lib/route";
import { createNote } from "../state/actions";
import { useIndex } from "../state/store";

export function Notes({ sub }: { sub?: string }) {
  return sub === "journal" ? <Journal /> : <NoteList />;
}

function NotesHead({ tab, sel }: { tab: "notes" | "journal"; sel: Selection }) {
  return (
    <>
      <div className="page-head row-head">
        <div><h1 className="display">{tab === "journal" ? "Journal" : "Notes"}</h1></div>
        <div className="head-actions">
          <SelectButton sel={sel} />
          {!sel.on && (tab === "notes"
            ? <button type="button" className="btn primary sm" onClick={() => go(docHref(createNote({ title: "Untitled" })))}><IconPlus /> Note</button>
            : <a className="btn primary sm" href={docHref(journalPath(todayISO()))}>Today</a>)}
        </div>
      </div>
      <Seg<"notes" | "journal"> label="Notes or journal" value={tab} onChange={(t) => go(t === "journal" ? "#notes/journal" : "#notes")}
        options={[{ id: "notes", label: "Notes" }, { id: "journal", label: "Journal" }]} />
    </>
  );
}

function NoteList() {
  const ix = useIndex();
  const [q, setQ] = useState("");
  const notes = useMemo(() => [...ix.docs.values()].filter((d) => d.kind === "note" || d.kind === "path").sort((a, b) => b.mtime - a.mtime || a.title.localeCompare(b.title)), [ix]);
  const s = q.trim().toLowerCase();
  const shown = s ? notes.filter((d) => d.title.toLowerCase().includes(s) || d.body.toLowerCase().includes(s)) : notes;
  const folders = useMemo(() => {
    const m = new Map<string, Doc[]>();
    for (const d of shown) {
      const f = d.path.includes("/") ? d.path.slice(0, d.path.lastIndexOf("/")) : "";
      const arr = m.get(f) ?? [];
      arr.push(d);
      m.set(f, arr);
    }
    return [...m].sort(([a], [b]) => (a === "Notes" ? -1 : b === "Notes" ? 1 : a.localeCompare(b)));
  }, [shown]);
  const sel = useSelection(folders.flatMap(([, docs]) => docs.map((d) => d.path)));

  return (
    <>
      <NotesHead tab="notes" sel={sel} />
      <label className="search">
        <IconSearch />
        <input type="search" dir="auto" placeholder="Filter notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter notes" />
        {q && <button type="button" className="search-clear" onClick={() => setQ("")} aria-label="Clear"><IconClose /></button>}
      </label>
      {folders.map(([f, docs]) => (
        <section key={f} className="card">
          <h2 className="folder-name">{f || "Vault"} <span className="muted">{docs.length}</span></h2>
          <ul className="item-list">{docs.map((d) => <NoteRow key={d.path} d={d} ix={ix} sel={sel} />)}</ul>
        </section>
      ))}
      {!shown.length && <div className="card empty"><p className="muted">{notes.length ? "No note matches." : "No notes yet. Notes can be about anything; give them a topic to file them."}</p></div>}
      <SelectBar sel={sel} />
    </>
  );
}

function Journal() {
  const ix = useIndex();
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const entries = useMemo(() => [...ix.docs.values()].filter((d) => d.kind === "journal" && d.date).sort((a, b) => b.date!.localeCompare(a.date!)), [ix]);
  const byDate = new Map(entries.map((d) => [d.date!, d]));
  const inMonth = entries.filter((d) => d.date!.startsWith(month));
  const first = parseISO(month + "-01");
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const shift = (n: number) => { const d = new Date(first.getFullYear(), first.getMonth() + n, 1); setMonth(iso(d).slice(0, 7)); };
  // days in a row with an entry, up to today (or yesterday, if today's isn't written yet)
  let streak = 0;
  for (const d = new Date(byDate.has(today) ? Date.now() : Date.now() - 86_400_000); byDate.has(iso(d)); d.setDate(d.getDate() - 1)) streak++;
  const sel = useSelection(inMonth.map((d) => d.path));

  return (
    <>
      <NotesHead tab="journal" sel={sel} />
      <section className="card">
        <div className="month-nav">
          <button type="button" className="icon-btn subtle" onClick={() => shift(-1)} aria-label="Month before"><IconBack /></button>
          <h2>{monthName(month)}</h2>
          <button type="button" className="icon-btn subtle" onClick={() => shift(1)} disabled={month >= today.slice(0, 7)} aria-label="Month after"><IconNext /></button>
        </div>
        <div className="cal" role="grid" aria-label={monthName(month)}>
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="cal-h" aria-hidden="true">{d}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, "0")}`;
            const has = byDate.has(date);
            const future = date > today;
            return (
              <a key={date} href={future ? undefined : docHref(journalPath(date))} className={`cal-d${has ? " has" : ""}${date === today ? " today" : ""}${future ? " future" : ""}`}
                aria-label={`${shortDate(date)}${has ? ", has an entry" : ""}`}>{i + 1}</a>
            );
          })}
        </div>
        <p className="muted small">{entries.length} entries{streak > 1 ? ` · ${streak} days in a row` : ""}</p>
      </section>
      {inMonth.length ? (
        <ul className="card item-list">{inMonth.map((d) => <NoteRow key={d.path} d={d} ix={ix} sel={sel} />)}</ul>
      ) : (
        <div className="card empty"><p className="muted">No entries this month.</p></div>
      )}
      <SelectBar sel={sel} />
    </>
  );
}

export function TagPage({ tag }: { tag: string }) {
  const ix = useIndex();
  const docs = (ix.tags.get(tag) ?? []).map((p) => ix.docs.get(p)).filter((d): d is Doc => !!d).sort((a, b) => b.mtime - a.mtime);
  const topic = [...ix.topics.values()].find((t) => t.name.toLowerCase().replace(/\s+/g, "-") === tag || t.id.toLowerCase().replace(/\s+/g, "-") === tag);
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Tag</span>
        <h1 className="display">#{tag}</h1>
        {topic && <p className="muted">Everything tagged #{tag} is also in <a href={`#topics/${topic.id}`}>{topic.name}</a>.</p>}
      </div>
      {docs.length ? <ul className="card item-list">{docs.map((d) => <DocRow key={d.path} d={d} ix={ix} />)}</ul>
        : <div className="card empty"><p className="muted">Nothing has this tag.</p></div>}
    </>
  );
}
