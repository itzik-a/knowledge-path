/* #library: every resource, filtered by status, type and topic, sorted by when it was added, title or author. */
import { useMemo, useState } from "react";
import { subtree } from "../../shared/index.ts";
import { RESOURCE_TYPES, STATUSES, type ResourceType, type Status } from "../../shared/vault.ts";
import { ResourceRow, STATUS_LABEL, TYPE_EMOJI, TYPE_LABEL } from "../components/bits";
import { IconClose, IconInbox, IconPlus, IconSearch } from "../components/Icons";
import { SelectBar, SelectButton, useSelection } from "../components/Select";
import { Select, useSessionState } from "../components/ui";
import { openSheet } from "../lib/sheets";
import { inbox } from "../../shared/index.ts";
import { useIndex } from "../state/store";

type Sort = "added" | "title" | "author";

export function Library() {
  const ix = useIndex();
  const [status, setStatus] = useSessionState<Status | "all">("kp.lib.status", "all");
  const [type, setType] = useSessionState<ResourceType | "all">("kp.lib.type", "all");
  const [topic, setTopic] = useSessionState<string>("kp.lib.topic", "");
  const [sort, setSort] = useSessionState<Sort>("kp.lib.sort", "added");
  const [q, setQ] = useState("");

  const all = useMemo(() => [...ix.docs.values()].filter((d) => d.kind === "resource"), [ix]);
  const inTopic = useMemo(() => (topic && ix.topics.has(topic) ? new Set(subtree(ix, topic)) : null), [ix, topic]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all
      .filter((d) => status === "all" || d.resource!.status === status)
      .filter((d) => type === "all" || d.resource!.type === type)
      .filter((d) => !inTopic || (ix.topicsOf.get(d.path) ?? []).some((id) => inTopic.has(id)))
      .filter((d) => !s || d.title.toLowerCase().includes(s) || (d.resource!.author ?? "").toLowerCase().includes(s))
      .sort((a, b) =>
        sort === "title" ? a.title.localeCompare(b.title)
        : sort === "author" ? (a.resource!.author ?? "~").localeCompare(b.resource!.author ?? "~") || a.title.localeCompare(b.title)
        : (b.resource!.added ?? "").localeCompare(a.resource!.added ?? "") || b.mtime - a.mtime || a.title.localeCompare(b.title));
  }, [all, status, type, inTopic, ix, q, sort]);

  const types = RESOURCE_TYPES.filter((t) => all.some((d) => d.resource!.type === t));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((d) => d.resource!.status === s).length])) as Record<Status, number>;
  const waiting = inbox(ix).length;
  const sel = useSelection(list.map((d) => d.path));

  return (
    <>
      <div className="page-head row-head">
        <div><h1 className="display">Library</h1><p className="muted">{all.length} resources · {counts["in-progress"]} in progress · {counts.done} done</p></div>
        <div className="head-actions">
          <SelectButton sel={sel} />
          {!sel.on && <button type="button" className="btn primary sm" onClick={() => openSheet({ kind: "capture", init: { mode: "link" } })}><IconPlus /> Add</button>}
        </div>
      </div>
      {waiting > 0 && (
        <a className="card inbox-banner" href="#inbox"><IconInbox /> <span className="grow"><b>{waiting} in the Inbox</b> <span className="muted">waiting for a topic</span></span><span className="chev">›</span></a>
      )}
      <section className="card filters">
        <label className="search">
          <IconSearch />
          <input type="search" dir="auto" placeholder="Filter by title or author" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter by title or author" />
          {q && <button type="button" className="search-clear" onClick={() => setQ("")} aria-label="Clear"><IconClose /></button>}
        </label>
        <div className="chips" role="group" aria-label="Status">
          <button type="button" className="chip" aria-pressed={status === "all"} onClick={() => setStatus("all")}>All</button>
          {(["in-progress", "next", "saved", "done"] as Status[]).map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(status === s ? "all" : s)}>{STATUS_LABEL[s]} <span className="count">{counts[s]}</span></button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Type">
          {types.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={type === t} onClick={() => setType(type === t ? "all" : t)}>{TYPE_EMOJI[t]} {TYPE_LABEL[t]}</button>
          ))}
        </div>
        <div className="form-row">
          <Select<string> value={topic} onChange={setTopic} label="Topic" options={[{ id: "", label: "Every topic" }, ...ix.topicOrder.map((id) => { const t = ix.topics.get(id)!; return { id, label: `${"  ".repeat(t.depth)}${t.name}` }; })]} />
          <Select<Sort> value={sort} onChange={setSort} label="Sort" options={[{ id: "added", label: "Newest first" }, { id: "title", label: "By title" }, { id: "author", label: "By author" }]} />
        </div>
      </section>
      {list.length ? (
        <ul className="card item-list">{list.map((d) => <ResourceRow key={d.path} d={d} ix={ix} sel={sel} />)}</ul>
      ) : (
        <div className="card empty"><p className="muted">{all.length ? "Nothing matches these filters." : "Nothing saved yet. Add a link, a book, a video…"}</p></div>
      )}
      <SelectBar sel={sel} what="resources" />
    </>
  );
}
