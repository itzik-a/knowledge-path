/* #topics: every topic. #topics/<id>: one topic: its overview, subtopics, and everything in it. */
import { useMemo, useState } from "react";
import { itemsIn, type Doc, type Index, type Topic } from "../../shared/index.ts";
import type { Status } from "../../shared/vault.ts";
import { Breadcrumb, DocRow, STATUS_LABEL, topicColor } from "../components/bits";
import { Explore } from "../components/Explore";
import { IconEdit, IconMore, IconPlus } from "../components/Icons";
import { NoteBody } from "../components/NoteBody";
import { Menu, Switch, useSessionState } from "../components/ui";
import { docHref, go, topicHref } from "../lib/route";
import { openSheet } from "../lib/sheets";
import { createNote, createPath } from "../state/actions";
import { useIndex } from "../state/store";

const count = (docs: Doc[]) => ({
  resources: docs.filter((d) => d.kind === "resource").length,
  notes: docs.filter((d) => d.kind !== "resource").length,
});

export function Topics({ sub }: { sub?: string }) {
  const ix = useIndex();
  if (sub) {
    const t = ix.topics.get(sub);
    if (!t) return <NoTopic id={sub} />;
    return <TopicPage key={t.id} t={t} ix={ix} />;
  }
  const top = ix.topicOrder.map((id) => ix.topics.get(id)!).filter((t) => !t.parent);
  return (
    <>
      <div className="page-head row-head">
        <div><h1 className="display">Topics</h1><p className="muted">{ix.topics.size} topics</p></div>
        <button type="button" className="btn primary sm" onClick={() => openSheet({ kind: "topic" })}><IconPlus /> Topic</button>
      </div>
      <div className="topic-grid">
        {top.map((t) => <TopicCard key={t.id} t={t} ix={ix} />)}
      </div>
      {!top.length && <div className="card empty"><p className="muted">No topics yet. Add the first thing you want to learn about.</p></div>}
    </>
  );
}

function TopicCard({ t, ix }: { t: Topic; ix: Index }) {
  const c = count(itemsIn(ix, t.id));
  return (
    <section className="card topic-card" style={{ ["--tc" as string]: topicColor(t) }}>
      <a className="topic-card-head" href={topicHref(t.id)}>
        <span className="topic-icon" aria-hidden="true">{t.icon ?? "•"}</span>
        <span className="grow">
          <span className="topic-name" dir="auto">{t.name}</span>
          {t.description && <span className="muted small clamp" dir="auto">{t.description}</span>}
        </span>
      </a>
      <p className="muted small">{c.resources} resources · {c.notes} notes</p>
      {t.children.length > 0 && (
        <div className="chips sub-chips">
          {t.children.map((id) => { const s = ix.topics.get(id)!; return <a key={id} className="chip" href={topicHref(id)} dir="auto">{s.name}</a>; })}
        </div>
      )}
    </section>
  );
}

function NoTopic({ id }: { id: string }) {
  return (
    <div className="card empty">
      <h2>No topic “{id}”</h2>
      <p className="muted">It may have been renamed or removed.</p>
      <a className="btn" href="#topics">All topics</a>
    </div>
  );
}

type Section = "resources" | "notes" | "journal" | "paths";
type Filter = "all" | Status;

function TopicPage({ t, ix }: { t: Topic; ix: Index }) {
  const [deep, setDeep] = useSessionState("kp.topic.deep", true);
  const [section, setSection] = useSessionState<Section>(`kp.topic.section`, "resources");
  const [filter, setFilter] = useSessionState<Filter>("kp.topic.filter", "all");
  const [editing, setEditing] = useState(false);
  const overview = ix.docs.get(t.path);
  const items = useMemo(() => itemsIn(ix, t.id, deep), [ix, t.id, deep]);

  const groups: Record<Section, Doc[]> = useMemo(() => {
    const byRecent = (a: Doc, b: Doc) => (b.resource?.added ?? "").localeCompare(a.resource?.added ?? "") || b.mtime - a.mtime || a.title.localeCompare(b.title);
    return {
      resources: items.filter((d) => d.kind === "resource").sort((a, b) => rank(a) - rank(b) || byRecent(a, b)),
      notes: items.filter((d) => d.kind === "note").sort((a, b) => b.mtime - a.mtime),
      journal: items.filter((d) => d.kind === "journal").sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
      paths: items.filter((d) => d.kind === "path"),
    };
  }, [items]);
  const resources = filter === "all" ? groups.resources : groups.resources.filter((d) => d.resource!.status === filter);
  const list = section === "resources" ? resources : groups[section];
  const tabs: { id: Section; label: string }[] = [
    { id: "resources", label: "Resources" }, { id: "notes", label: "Notes" }, { id: "journal", label: "Journal" }, { id: "paths", label: "Paths" },
  ];

  function add() {
    if (section === "resources") openSheet({ kind: "capture", init: { topics: [t.id], mode: "link" } });
    else if (section === "notes") go(docHref(createNote({ title: "Untitled", topics: [t.id] })));
    else if (section === "paths") go(docHref(createPath(`${t.name} path`, [t.id])));
  }

  return (
    <>
      <Breadcrumb ix={ix} id={t.id} />
      <section className="card topic-head" style={{ ["--tc" as string]: topicColor(t) }}>
        <div className="note-head">
          <span className="topic-icon big" aria-hidden="true">{t.icon ?? "•"}</span>
          <div className="grow">
            <h1 className="display" dir="auto">{t.name}</h1>
            {t.description && <p className="muted" dir="auto">{t.description}</p>}
          </div>
          <Menu label="Topic options" icon={<IconMore />} items={[
            { label: "Edit topic", run: () => openSheet({ kind: "topic", id: t.id }) },
            { label: "Add a subtopic", run: () => openSheet({ kind: "topic", parent: t.id }) },
            { label: editing ? "Done editing the overview" : "Edit the overview", run: () => setEditing((x) => !x) },
          ]} />
        </div>
        <div className="body-wrap">
          <div className="body-tools">
            <button type="button" className="btn ghost sm" onClick={() => setEditing((x) => !x)}>{editing ? "Done" : <><IconEdit /> Overview</>}</button>
          </div>
          <NoteBody path={t.path} body={overview?.body ?? ""} editing={editing} autoFocus placeholder={`What ${t.name} means to me, what I want to learn, open questions…`}
            empty="No overview yet: what do you want from this topic?" />
        </div>
        {(t.children.length > 0) && (
          <div className="chips sub-chips">
            {t.children.map((id) => {
              const s = ix.topics.get(id)!;
              const n = itemsIn(ix, id).length;
              return <a key={id} className="chip" href={topicHref(id)}><span dir="auto">{s.name}</span> <span className="muted">{n}</span></a>;
            })}
            <button type="button" className="chip add" onClick={() => openSheet({ kind: "topic", parent: t.id })}><IconPlus width={14} height={14} /> Subtopic</button>
          </div>
        )}
      </section>

      <Explore t={t} ix={ix} />

      <section className="card">
        <div className="tabs" role="tablist" aria-label="In this topic">
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={section === x.id} onClick={() => setSection(x.id)}>
              {x.label} <span className="count">{groups[x.id].length}</span>
            </button>
          ))}
        </div>
        <div className="row-between">
          {section === "resources" ? (
            <div className="chips">
              {(["all", "next", "in-progress", "done", "saved"] as Filter[]).map((f) => (
                <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : STATUS_LABEL[f]}</button>
              ))}
            </div>
          ) : <span />}
          {t.children.length > 0 && (
            <label className="switch-row small"><Switch on={deep} onChange={setDeep} label="Include subtopics" /> Subtopics too</label>
          )}
        </div>
        {list.length ? (
          <ul className="item-list">{list.map((d) => <DocRow key={d.path} d={d} ix={ix} showTopics={deep && t.children.length > 0} />)}</ul>
        ) : (
          <p className="muted small">{EMPTY[section]}</p>
        )}
        {section !== "journal" && (
          <button type="button" className="btn ghost sm" onClick={add}><IconPlus /> {section === "resources" ? "Add a resource" : section === "notes" ? "New note" : "New study path"}</button>
        )}
      </section>
    </>
  );
}

const EMPTY: Record<Section, string> = {
  resources: "Nothing here yet.",
  notes: "No notes yet. Notes join a topic when they list it in their topics or link to it.",
  journal: "Journal entries that mention this topic (with [[its name]] or #its-tag) show up here.",
  paths: "A study path is an ordered list of things to read, watch and do.",
};

const rank = (d: Doc) => ({ "in-progress": 0, next: 1, saved: 2, done: 3 })[d.resource!.status];
