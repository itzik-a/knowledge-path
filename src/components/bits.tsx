/* Small pieces used across views: topic chips and picker, resource and note rows, status. */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ancestry, type Doc, type Index, type Topic } from "../../shared/index.ts";
import { currentStage, parseStages, parseSteps, type ResourceType, type Status } from "../../shared/vault.ts";
import { shortDate, whenText } from "../lib/dates";
import { docHref, topicHref } from "../lib/route";
import { useIndex } from "../state/store";
import { showToast } from "../lib/toast";
import type { Selection } from "./Select";
import { IconCheck, IconClose, IconLock, IconPin, IconPlus, IconSearch } from "./Icons";
import { RecipeRow } from "./recipes";
import { clozeParts } from "../../shared/cards.ts";

export const TYPE_LABEL: Record<ResourceType, string> = { article: "Article", video: "Video", book: "Book", podcast: "Podcast", paper: "Paper", course: "Course", site: "Website", other: "Other" };
export const TYPE_EMOJI: Record<ResourceType, string> = { article: "📄", video: "▶️", book: "📕", podcast: "🎧", paper: "📑", course: "🎓", site: "🌐", other: "📎" };
export const STATUS_LABEL: Record<Status, string> = { saved: "Saved", next: "Up next", "in-progress": "In progress", done: "Done" };

export const topicColor = (t?: Topic) => (t?.color ? `var(--s${t.color})` : "var(--s-other)");

export function TopicChip({ t, small }: { t: Topic; small?: boolean }) {
  return (
    <a className={`topic-chip${small ? " sm" : ""}`} href={topicHref(t.id)}>
      <span className="swatch sm" style={{ background: topicColor(t) }} />
      <span dir="auto">{t.name}</span>
    </a>
  );
}

export function TopicChips({ ix, path, max = 3 }: { ix: Index; path: string; max?: number }) {
  const ids = ix.topicsOf.get(path) ?? [];
  if (!ids.length) return null;
  return (
    <span className="topic-chips">
      {ids.slice(0, max).map((id) => { const t = ix.topics.get(id); return t ? <span key={id} className="topic-mini"><span className="swatch sm" style={{ background: topicColor(t) }} /><span dir="auto">{t.name}</span></span> : null; })}
      {ids.length > max && <span className="topic-mini">+{ids.length - max}</span>}
    </span>
  );
}

/** Choose topics: selected ones as removable chips, the rest in a searchable list. `fixed` are topics the item is in through links or tags. */
export function TopicPicker({ value, onChange, fixed = [], suggested = [] }: { value: string[]; onChange: (ids: string[]) => void; fixed?: string[]; suggested?: string[] }) {
  const ix = useIndex();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sel = new Set(value);
  const options = useMemo(() => ix.topicOrder.map((id) => ix.topics.get(id)!).filter((t) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return t.name.toLowerCase().includes(s) || t.id.toLowerCase().includes(s);
  }), [ix, q]);
  const sugg = suggested.filter((id) => ix.topics.has(id) && !sel.has(id) && !fixed.includes(id));
  const toggle = (id: string) => onChange(sel.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  // Undo reads the latest value and onChange, so it still works after other edits or once the picker is gone.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  // The whole chip removes, so a stray tap is easy: offer Undo, putting the topic back where it was.
  const remove = (id: string) => {
    const at = value.indexOf(id);
    onChange(value.filter((x) => x !== id));
    showToast(`Removed ${ix.topics.get(id)?.name ?? id}`, { label: "Undo", run: () => {
      const { value: cur, onChange: set } = latest.current;
      if (cur.includes(id)) return;
      set([...cur.slice(0, at), id, ...cur.slice(at)]);
    } });
  };

  return (
    <div className="picker">
      <div className="chips">
        {value.filter((id) => ix.topics.has(id)).map((id) => (
          <button key={id} type="button" className="chip on" onClick={() => remove(id)} aria-label={`Remove ${ix.topics.get(id)!.name}`}>
            <span className="swatch sm" style={{ background: topicColor(ix.topics.get(id)) }} /> <span dir="auto">{ix.topics.get(id)!.name}</span> <IconClose width={12} height={12} />
          </button>
        ))}
        {fixed.filter((id) => !sel.has(id) && ix.topics.has(id)).map((id) => (
          <span key={id} className="chip fixed" title="Linked or tagged in the text">
            <span className="swatch sm" style={{ background: topicColor(ix.topics.get(id)) }} /> <span dir="auto">{ix.topics.get(id)!.name}</span>
          </span>
        ))}
        {sugg.map((id) => (
          <button key={id} type="button" className="chip suggest" onClick={() => toggle(id)} title="Suggested">
            <IconPlus width={13} height={13} /> <span dir="auto">{ix.topics.get(id)!.name}</span>
          </button>
        ))}
        <button type="button" className="chip add" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Done" : <><IconPlus width={14} height={14} /> Topic</>}
        </button>
      </div>
      {open && (
        <div className="picker-list">
          <label className="search sm">
            <IconSearch />
            <input type="search" placeholder="Find a topic" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a topic" />
          </label>
          <ul>
            {options.map((t) => (
              <li key={t.id}>
                <button type="button" aria-pressed={sel.has(t.id)} style={{ paddingLeft: 10 + (q ? 0 : t.depth * 18) }} onClick={() => toggle(t.id)}>
                  <span className="swatch sm" style={{ background: topicColor(t) }} />
                  <span dir="auto" className="grow">{t.icon && !t.parent ? `${t.icon} ` : ""}{t.name}</span>
                  {sel.has(t.id) && <IconCheck />}
                </button>
              </li>
            ))}
            {!options.length && <li className="muted small pad">No topic called that.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return <span className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></span>;
}

export function StatusPill({ status }: { status: Status }) {
  if (status === "saved") return null;
  return <span className={`status-pill s-${status}`}>{status === "done" && <IconCheck width={11} height={11} />}{STATUS_LABEL[status]}</span>;
}

/** A list row: a link, or in select mode a checkbox. */
function RowShell({ path, sel, children }: { path: string; sel?: Selection; children: ReactNode }) {
  if (sel?.on) {
    const on = sel.has(path);
    return (
      <button type="button" className="item-row picking" role="checkbox" aria-checked={on} onClick={() => sel.toggle(path)}>
        <span className={`pick${on ? " on" : ""}`} aria-hidden="true">{on && <IconCheck width={13} height={13} />}</span>
        {children}
      </button>
    );
  }
  return <a className="item-row" href={docHref(path)}>{children}</a>;
}

export function ResourceRow({ d, ix, showTopics = true, sel }: { d: Doc; ix: Index; showTopics?: boolean; sel?: Selection }) {
  const r = d.resource!;
  const meta = [r.author, r.site && !r.author ? r.site : undefined, TYPE_LABEL[r.type]].filter(Boolean).join(" · ");
  const when = rowDate(d, "Added");
  return (
    <li>
      <RowShell path={d.path} sel={sel}>
        {r.image ? <img className="thumb" src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="thumb emoji" aria-hidden="true">{TYPE_EMOJI[r.type]}</span>}
        <span className="item-main">
          <span className="item-title" dir="auto">{d.title}</span>
          <span className="item-meta" dir="auto">{meta}</span>
          {(showTopics || r.status !== "saved" || when) && (
            <span className="item-tags">
              <StatusPill status={r.status} />
              {when && <span className="muted small">{when}</span>}
              {r.enrich === "pending" && <span className="tag">Fetching details…</span>}
              {r.enrich !== "pending" && r.summarize === "pending" && <span className="tag">Summarising…</span>}
              {showTopics && <TopicChips ix={ix} path={d.path} max={2} />}
            </span>
          )}
        </span>
      </RowShell>
    </li>
  );
}

/** The little picture for an item: its type for a saved link, else its kind (a habit's own icon). */
export function docEmoji(d: Doc): string {
  if (d.kind === "resource") return TYPE_EMOJI[d.resource!.type];
  return d.kind === "journal" ? "📓" : d.kind === "path" ? "🧭" : d.kind === "habit" ? d.habit?.icon ?? "🔁" : d.kind === "recipe" ? "🍲" : d.kind === "chapter" ? "📖" : "📝";
}

/** A row's date: "Updated today 22:39", else "Added 27 Nov 2026" / "Created 25 Nov 2026". */
const rowDate = (d: Doc, made: string) => (d.updated ? `Updated ${whenText(d.updated)}` : d.created ? `${made} ${whenText(d.created)}` : undefined);

/** "Created 23 Nov 2026 · Updated today 17:40" for a note or saved link (whichever it has). */
export function DocDates({ d }: { d: Doc }) {
  const upd = d.updated;
  if (!d.created && !upd) return null;
  return (
    <p className="muted small doc-dates">
      {d.created && <span>Created {whenText(d.created)}</span>}
      {d.created && upd && " · "}
      {upd && <span>Updated {whenText(upd, { time: true })}</span>}
    </p>
  );
}

/** An item's name in a short list: a journal day by its date. */
export const docLabel = (d: Doc) => (d.kind === "journal" && d.date ? shortDate(d.date) : d.title);

export function NoteRow({ d, ix, showTopics = true, sel }: { d: Doc; ix: Index; showTopics?: boolean; sel?: Selection }) {
  const label = docLabel(d);
  const when = d.kind === "journal" ? "Journal" : d.kind === "path" ? "Study path" : d.kind === "habit" ? "Habit" : d.kind === "recipe" ? "Recipe" : rowDate(d, "Created");
  return (
    <li>
      <RowShell path={d.path} sel={sel}>
        <span className="thumb emoji" aria-hidden="true">{docEmoji(d)}</span>
        <span className="item-main">
          <span className="item-title" dir="auto">{label}{d.private && <IconLock className="inline-icon" role="img" aria-label="Locked" aria-hidden={false} />}{d.pinned && <IconPin className="inline-icon pin-mark" role="img" aria-label="Pinned" aria-hidden={false} />}</span>
          {d.excerpt && <span className="item-meta clamp" dir="auto">{d.excerpt}</span>}
          {(showTopics || when) && (
            <span className="item-tags">
              {when && <span className="muted small">{when}</span>}
              {showTopics && <TopicChips ix={ix} path={d.path} max={2} />}
            </span>
          )}
        </span>
      </RowShell>
    </li>
  );
}

/** How far a study path is: steps done, and for a roadmap the stage to work on. */
export function pathProgress(d: Doc) {
  const steps = parseSteps(d.body);
  const done = steps.filter((x) => x.done).length;
  const { stages } = parseStages(d.body);
  const cur = stages.length ? currentStage(stages) : -1;
  return { done, total: steps.length, stages: stages.length, stage: cur >= 0 ? stages[cur].title || `Stage ${cur + 1}` : undefined };
}

/** A study path in a list: its progress (and a roadmap's current stage), its topics or "No topic", its date. */
export function PathRow({ d, ix, showTopics = true, sel }: { d: Doc; ix: Index; showTopics?: boolean; sel?: Selection }) {
  const p = useMemo(() => pathProgress(d), [d]);
  const finished = p.total > 0 && p.done === p.total;
  const meta = finished ? `Done · all ${p.total} steps` : p.stage ? `Now: ${p.stage}` : `${p.done} of ${p.total} done`;
  const when = rowDate(d, "Created");
  const topicless = !(ix.topicsOf.get(d.path) ?? []).length;
  return (
    <li>
      <RowShell path={d.path} sel={sel}>
        <span className="thumb emoji" aria-hidden="true">🧭</span>
        <span className="item-main">
          <span className="item-title" dir="auto">{d.title}{d.pinned && <IconPin className="inline-icon pin-mark" role="img" aria-label="Pinned" aria-hidden={false} />}</span>
          <span className="item-meta" dir="auto">{p.stages ? `Roadmap · ` : ""}{meta}{p.stage && !finished ? ` · ${p.done} of ${p.total}` : ""}</span>
          {p.total > 0 && <span className="path-row-bar"><Progress value={Math.round((p.done / p.total) * 100)} /></span>}
          <span className="item-tags">
            {when && <span className="muted small">{when}</span>}
            {showTopics && (topicless ? <span className="tag">No topic</span> : <TopicChips ix={ix} path={d.path} max={2} />)}
          </span>
        </span>
      </RowShell>
    </li>
  );
}

export function DocRow({ d, ix, showTopics, sel }: { d: Doc; ix: Index; showTopics?: boolean; sel?: Selection }) {
  if (d.kind === "recipe" && !sel?.on) return <RecipeRow d={d} ix={ix} showTopics={showTopics} />;
  if (d.kind === "path") return <PathRow d={d} ix={ix} showTopics={showTopics} sel={sel} />;
  return d.kind === "resource" ? <ResourceRow d={d} ix={ix} showTopics={showTopics} sel={sel} /> : <NoteRow d={d} ix={ix} showTopics={showTopics} sel={sel} />;
}

export function Breadcrumb({ ix, id, self = false }: { ix: Index; id: string; self?: boolean }) {
  const chain = ancestry(ix, id);
  const shown = self ? chain : chain.slice(0, -1);
  if (!shown.length) return <a className="eyebrow crumb" href="#topics">Topics</a>;
  return (
    <nav className="crumbs eyebrow" aria-label="Topic path">
      <a href="#topics">Topics</a>
      {shown.map((t) => <span key={t.id}> › <a href={topicHref(t.id)} dir="auto">{t.name}</a></span>)}
    </nav>
  );
}

/** A highlight's text, its ==cloze== words marked (they're hidden on its flashcard). */
export function QuoteText({ q }: { q: string }) {
  return <>{clozeParts(q).map((p, i) => (p.hidden ? <mark key={i}>{p.text}</mark> : p.text))}</>;
}
