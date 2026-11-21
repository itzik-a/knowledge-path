/* Small pieces used across views: topic chips and picker, resource and note rows, status, stars. */
import { useMemo, useState } from "react";
import { ancestry, type Doc, type Index, type Topic } from "../../shared/index.ts";
import type { ResourceType, Status } from "../../shared/vault.ts";
import { medDate, shortDate } from "../lib/dates";
import { docHref, topicHref } from "../lib/route";
import { useIndex } from "../state/store";
import { IconCheck, IconClose, IconPlus, IconSearch, IconStar } from "./Icons";

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

  return (
    <div className="picker">
      <div className="chips">
        {value.filter((id) => ix.topics.has(id)).map((id) => (
          <button key={id} type="button" className="chip on" onClick={() => toggle(id)} aria-label={`Remove ${ix.topics.get(id)!.name}`}>
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

export function ResourceRow({ d, ix, showTopics = true }: { d: Doc; ix: Index; showTopics?: boolean }) {
  const r = d.resource!;
  const meta = [r.author, r.site && !r.author ? r.site : undefined, TYPE_LABEL[r.type]].filter(Boolean).join(" · ");
  return (
    <li>
      <a className="item-row" href={docHref(d.path)}>
        {r.image ? <img className="thumb" src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="thumb emoji" aria-hidden="true">{TYPE_EMOJI[r.type]}</span>}
        <span className="item-main">
          <span className="item-title" dir="auto">{d.title}</span>
          <span className="item-meta" dir="auto">{meta}</span>
          {(showTopics || r.status !== "saved") && (
            <span className="item-tags">
              <StatusPill status={r.status} />
              {r.enrich === "pending" && <span className="tag">Fetching details…</span>}
              {showTopics && <TopicChips ix={ix} path={d.path} max={2} />}
            </span>
          )}
          {r.status === "in-progress" && r.progress != null && <Progress value={r.progress} />}
        </span>
      </a>
    </li>
  );
}

export function NoteRow({ d, ix, showTopics = true }: { d: Doc; ix: Index; showTopics?: boolean }) {
  const label = d.kind === "journal" && d.date ? shortDate(d.date) : d.title;
  const when = d.kind === "journal" ? "Journal" : d.kind === "path" ? "Study path" : typeof d.fm.created === "string" ? medDate(d.fm.created) : undefined;
  return (
    <li>
      <a className="item-row" href={docHref(d.path)}>
        <span className="thumb emoji" aria-hidden="true">{d.kind === "journal" ? "📓" : d.kind === "path" ? "🧭" : "📝"}</span>
        <span className="item-main">
          <span className="item-title" dir="auto">{label}</span>
          {d.excerpt && <span className="item-meta clamp" dir="auto">{d.excerpt}</span>}
          {(showTopics || when) && (
            <span className="item-tags">
              {when && <span className="muted small">{when}</span>}
              {showTopics && <TopicChips ix={ix} path={d.path} max={2} />}
            </span>
          )}
        </span>
      </a>
    </li>
  );
}

export function DocRow({ d, ix, showTopics }: { d: Doc; ix: Index; showTopics?: boolean }) {
  return d.kind === "resource" ? <ResourceRow d={d} ix={ix} showTopics={showTopics} /> : <NoteRow d={d} ix={ix} showTopics={showTopics} />;
}

export function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => onChange(value === n ? 0 : n)}>
          <IconStar filled={n <= value} />
        </button>
      ))}
    </div>
  );
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
