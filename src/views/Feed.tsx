/* The Inbox's Feed tab (#inbox/feed): what the collector found, waiting for a decision. Nothing here is part of the
   knowledge base until it's kept: Keep makes it a saved link with the topics chosen (none: it waits in To file),
   Dismiss sets it aside; both with Undo. Feed topic chips, Latest (by day) or Top (by score), select mode to keep or
   dismiss several. Run now asks the vault's Feed workflow for a run; Settings is #inbox/feed/settings. */
import { useMemo, useState } from "react";
import type { Entry, EntrySource, FeedSettings, Topic } from "../../shared/feed.ts";
import { TopicPicker } from "../components/bits";
import { IconCheck, IconClose, IconExternal, IconRefresh, IconSliders, IconThumbDown, IconThumbUp, IconVideo } from "../components/Icons";
import { Seg, Sheet, closeSheet, useSessionState } from "../components/ui";
import { dismissEntries, keepEntries, runNow, useFeed, useFeedMarks, useFeedSettings, useRunning, useWaiting, vote } from "../state/feed";
import { useIndex } from "../state/store";
import { getConfig } from "../state/sync";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export function ago(t: number, now = Date.now()): string {
  const d = now - t;
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.round(d / MIN)} min ago`;
  if (d < DAY) return `${Math.round(d / HOUR)} h ago`;
  if (d < 2 * DAY) return "yesterday";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const dayKey = (t: number) => new Date(t).toLocaleDateString("en-CA");
function dayLabel(t: number, now = Date.now()): string {
  if (dayKey(t) === dayKey(now)) return "Today";
  if (dayKey(t) === dayKey(now - DAY)) return "Yesterday";
  return new Date(t).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
const isRtl = (lang?: string) => !!lang && /^(he|iw|ar|fa|ur|yi)\b/i.test(lang);
const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);
const BASIS: Record<EntrySource["basis"], string> = { full: "", excerpt: "summary from the excerpt only", description: "from the video description", headline: "headline only" };
const scoreClass = (s: number) => (s >= 85 ? "score hi" : s >= 70 ? "score mid" : "score");

/** An entry belongs under a feed topic when it reached that topic's threshold. */
const inTopic = (e: Entry, t: Topic) => e.topics.some((x) => x.topic === t.id && x.score >= t.minScore);

export function FeedTab() {
  const { feed, status, error } = useFeed();
  const settings = useFeedSettings();
  const waiting = useWaiting();
  const [topicId, setTopicId] = useSessionState("knowledgePath.feedTopic", "");
  const [sort, setSort] = useSessionState<"latest" | "top">("knowledgePath.feedSort", "latest");
  const [open, setOpen] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [keeping, setKeeping] = useState<Entry[] | null>(null);
  const topics = useMemo(() => settings.topics.filter((t) => !t.deletedAt), [settings]);
  const topicMap = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const topic = topicMap.get(topicId);
  const shown = (topic ? waiting.filter((e) => inTopic(e, topic)) : waiting).slice().sort(sort === "top" ? (a, b) => b.score - a.score || b.publishedAt - a.publishedAt : (a, b) => b.publishedAt - a.publishedAt);
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const picked = sel ? shown.filter((e) => sel.has(e.id)) : [];

  if (!getConfig()) return <div className="card empty"><p className="muted">Connect the vault (Vault &amp; settings) to read the feed.</p></div>;

  const groups: { label: string; items: Entry[] }[] = [];
  if (sort === "latest") for (const e of shown) { const l = dayLabel(e.publishedAt); const g = groups.at(-1); if (g?.label === l) g.items.push(e); else groups.push({ label: l, items: [e] }); }
  else groups.push({ label: "", items: shown });

  return (
    <>
      <FeedBar settings={settings} count={waiting.length} selecting={!!sel} onSelect={() => setSel(sel ? null : new Set())} canSelect={shown.length > 0} />
      {status === "error" && !feed && <div className="card note-card"><p className="small">Couldn't read the feed: {error}</p></div>}
      {status === "none" && (
        <div className="card empty">
          <h2>No feed yet</h2>
          <p className="muted">Run now reads your sources, has Claude score and summarize what's new, and puts it here to review. Automatic runs are off until you turn them on in Settings.</p>
        </div>
      )}
      {feed && topics.length > 0 && (
        <div className="feed-filters">
          <div className="chips" role="group" aria-label="Feed topic">
            <button type="button" className="chip" aria-pressed={!topic} onClick={() => setTopicId("")}>All <span className="muted">{waiting.length}</span></button>
            {topics.filter((t) => t.enabled).map((t) => {
              const n = waiting.filter((e) => inTopic(e, t)).length;
              return <button key={t.id} type="button" className="chip" aria-pressed={topic?.id === t.id} onClick={() => setTopicId(topic?.id === t.id ? "" : t.id)}>{t.name} <span className="muted">{n}</span></button>;
            })}
          </div>
          <Seg<"latest" | "top"> label="Order" value={sort} onChange={setSort} options={[{ id: "latest", label: "Latest" }, { id: "top", label: "Top" }]} />
        </div>
      )}
      {feed && !shown.length && (
        <div className="card empty">
          <p className="muted">{waiting.length ? "Nothing waiting under this topic." : "All reviewed."} {feed.updatedAt ? `Last run ${ago(feed.updatedAt)}.` : ""}</p>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.label || "all"} className="feed-day" aria-label={g.label || "Entries"}>
          {g.label && <h2 className="eyebrow feed-day-head">{g.label}</h2>}
          {g.items.map((e) => (
            <EntryCard key={e.id} entry={e} topics={topicMap} keepDays={settings.keepDays} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)}
              selecting={!!sel} selected={!!sel?.has(e.id)} onSelect={() => toggleSel(e.id)} onKeep={() => setKeeping([e])} />
          ))}
        </section>
      ))}
      {sel && (
        <div className="select-bar feed-select-bar" role="toolbar" aria-label="Selected entries">
          <span className="muted small">{picked.length ? `${picked.length} selected` : "Tap entries to select"}</span>
          <button type="button" className="text-btn" onClick={() => setSel(picked.length === shown.length ? new Set() : new Set(shown.map((e) => e.id)))}>{picked.length === shown.length ? "None" : "All"}</button>
          <button type="button" className="btn sm" disabled={!picked.length} onClick={() => { dismissEntries(picked.map((e) => e.id)); setSel(null); }}>Dismiss</button>
          <button type="button" className="btn primary sm" disabled={!picked.length} onClick={() => setKeeping(picked)}>Keep…</button>
        </div>
      )}
      {keeping && <KeepSheet entries={keeping} topics={topicMap} onClose={() => setKeeping(null)} onDone={() => setSel(null)} />}
    </>
  );
}

/** Run now (with how it's going), Select, Settings, and when the feed last ran. */
function FeedBar({ settings, count, selecting, onSelect, canSelect }: { settings: FeedSettings; count: number; selecting: boolean; onSelect: () => void; canSelect: boolean }) {
  const { feed } = useFeed();
  const running = useRunning();
  const last = feed?.runs[0];
  return (
    <div className="feed-bar">
      <p className="muted small">
        {running && !running.stale ? (
          <span className="feed-running"><span className="dot busy" />
            {running.sent ? <>Running… usually 2–4 minutes{running.since ? `, asked ${ago(running.since)}` : ""}. You can close the app: it runs on GitHub.</> : "Sending the request to GitHub…"}
          </span>
        ) : running?.stale ? <span className="form-error">The run asked for {running.since ? ago(running.since) : "earlier"} didn't report back. See the vault's Actions on GitHub, or run it again.</span>
          : last ? <>Last run {ago(last.at)}{last.added ? `, ${last.added} new` : ""}{feed?.waiting ? ` · ${feed.waiting} items read since, for the next run` : ""}</>
          : feed ? "Not run yet" : ""}
        {!running && !settings.auto.on && <> · automatic runs off</>}
        {count > 0 && <> · {count} to review</>}
      </p>
      <div className="head-actions">
        {canSelect && <button type="button" className="btn ghost sm" aria-pressed={selecting} onClick={onSelect}>{selecting ? "Done" : "Select"}</button>}
        <RunButton />
        <a className="icon-btn subtle" href="#inbox/feed/settings" aria-label="Feed settings" title="Feed settings"><IconSliders width={20} height={20} /></a>
      </div>
    </div>
  );
}

/** Run now, or Running… (disabled) while a run is on its way, so two never overlap. */
export function RunButton() {
  const running = useRunning();
  const busy = !!running && !running.stale;
  return (
    <button type="button" className="btn ghost sm" disabled={busy} aria-busy={busy} onClick={runNow}>
      <IconRefresh width={16} height={16} className={busy ? "spin" : undefined} /> {busy ? "Running…" : "Run now"}
    </button>
  );
}

function EntryCard({ entry, topics, keepDays, open, onToggle, selecting, selected, onSelect, onKeep }: {
  entry: Entry; topics: Map<string, Topic>; keepDays: number; open: boolean; onToggle: () => void;
  selecting: boolean; selected: boolean; onSelect: () => void; onKeep: () => void;
}) {
  const marks = useFeedMarks();
  const myVote = marks[entry.id]?.v ?? 0;
  const dir = isRtl(entry.lang) ? "rtl" : "ltr";
  const top = entry.topics[0];
  const topic = top && topics.get(top.topic);
  const first = entry.sources[0];
  const others = new Set(entry.sources.map((s) => s.sourceName)).size - 1;
  const image = safeUrl(entry.image);
  const left = Math.ceil((entry.createdAt + keepDays * DAY - Date.now()) / DAY);
  return (
    <article className={`entry card${open ? " open" : ""}${selected ? " selected" : ""}`} aria-labelledby={`t-${entry.id}`}>
      <button type="button" className="entry-toggle" aria-expanded={selecting ? undefined : open} aria-pressed={selecting ? selected : undefined} onClick={selecting ? onSelect : onToggle}>
        <span className="entry-meta">
          {selecting && <span className={`feed-pick${selected ? " on" : ""}`} aria-hidden="true">{selected && <IconCheck width={14} height={14} />}</span>}
          {topic && <span className={scoreClass(top.score)} title={`${topic.name}: scored ${top.score} of 100`}>{topic.name} · {top.score}</span>}
          <span className="entry-src">{first?.kind === "video" && <IconVideo />}{first?.sourceName}{others > 0 && ` +${others}`}</span>
          <span className="muted">· {ago(entry.publishedAt)}</span>
          {left <= 2 && <span className="muted">· {left <= 0 ? "goes today" : left === 1 ? "goes tomorrow" : "2 days left"}</span>}
        </span>
        <span className="entry-body">
          <span className="entry-text" dir={dir}>
            <span className="entry-title" id={`t-${entry.id}`}>{entry.title}</span>
            <span className="entry-tldr">{entry.tldr}</span>
          </span>
          {image && !open && <img className="entry-thumb" src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        </span>
      </button>

      {open && !selecting && (
        <div className="entry-more">
          {entry.bullets.length > 0 && <ul className="bullets" dir={dir}>{entry.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
          {entry.why && (
            <div className="why" dir={dir}>
              <span className="eyebrow">{dir === "rtl" ? "למה זה חשוב" : "Why it matters"}</span>
              <p>{entry.why}</p>
            </div>
          )}
          <div className="entry-sources">
            <span className="eyebrow">{entry.sources.length === 1 ? "Source" : `${entry.sources.length} sources`}</span>
            <ul>
              {entry.sources.map((s) => (
                <li key={s.url}>
                  <a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer">
                    <span className="src-name">{s.kind === "video" && <IconVideo />}{s.sourceName} <IconExternal width={14} height={14} /></span>
                    <span className="src-title" dir="auto">{s.title}</span>
                  </a>
                  <span className="muted small">{ago(s.publishedAt)}{BASIS[s.basis] && ` · ${BASIS[s.basis]}`}</span>
                </li>
              ))}
            </ul>
          </div>
          {entry.topics.length > 1 && <p className="muted small">Scores: {entry.topics.map((t) => `${topics.get(t.topic)?.name ?? t.topic} ${t.score}`).join(" · ")}</p>}
        </div>
      )}

      {!selecting && (
        <div className="entry-actions">
          <button type="button" className="btn primary sm" onClick={onKeep}><IconCheck width={16} height={16} /> Keep</button>
          <button type="button" className="btn ghost sm" onClick={() => dismissEntries([entry.id])}><IconClose width={16} height={16} /> Dismiss</button>
          <span className="entry-votes">
            <button type="button" className={`icon-btn subtle${myVote === 1 ? " on" : ""}`} aria-pressed={myVote === 1} aria-label="More like this" title="More like this" onClick={() => vote(entry.id, 1)}><IconThumbUp /></button>
            <button type="button" className={`icon-btn subtle${myVote === -1 ? " on" : ""}`} aria-pressed={myVote === -1} aria-label="Less like this" title="Less like this" onClick={() => vote(entry.id, -1)}><IconThumbDown /></button>
          </span>
        </div>
      )}
    </article>
  );
}

/** Keep one or several: the topics they go under (suggested from the feed topic's name and from where entries of the
    same feed topic were kept before). No topic: they wait in To file. */
function KeepSheet({ entries, topics, onClose, onDone }: { entries: Entry[]; topics: Map<string, Topic>; onClose: () => void; onDone: () => void }) {
  const ix = useIndex();
  const marks = useFeedMarks();
  const { feed } = useFeed();
  const [chosen, setChosen] = useState<string[]>([]);
  const suggested = useMemo(() => {
    const feedTopics = new Set(entries.map((e) => e.topics[0]?.topic).filter(Boolean));
    const score = new Map<string, number>();
    // where I kept entries of the same feed topic
    for (const e of feed?.entries ?? []) {
      const m = marks[e.id];
      if (m?.s !== "kept" || !m.path || !feedTopics.has(e.topics[0]?.topic)) continue;
      for (const t of ix.topicsOf.get(m.path) ?? []) score.set(t, (score.get(t) ?? 0) + 2);
    }
    // knowledge topics whose name shares a word with the feed topic's name
    const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));
    for (const ft of feedTopics) {
      const fw = words(topics.get(ft!)?.name ?? "");
      for (const t of ix.topics.values()) if ([...words(t.name)].some((w) => fw.has(w))) score.set(t.id, (score.get(t.id) ?? 0) + 1);
    }
    return [...score].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => ix.topics.has(id)).slice(0, 5);
  }, [entries, feed, marks, ix, topics]);
  const keep = (el: HTMLElement) => { keepEntries(entries, chosen); onDone(); closeSheet(el); };
  return (
    <Sheet title={entries.length === 1 ? "Keep" : `Keep ${entries.length}`} onClose={onClose}>
      <div className="form-grid">
        {entries.length === 1
          ? <p className="keep-title" dir="auto"><b>{entries[0].title}</b></p>
          : <ul className="keep-list">{entries.slice(0, 6).map((e) => <li key={e.id} dir="auto">{e.title}</li>)}{entries.length > 6 && <li className="muted">and {entries.length - 6} more</li>}</ul>}
        <div className="field">
          <span className="field-label">Topics</span>
          <TopicPicker value={chosen} onChange={setChosen} suggested={suggested} />
          <span className="muted small">{entries.length === 1 ? "It becomes" : "They become"} a saved link with the summary; the article is fetched as for any link. Without a topic, {entries.length === 1 ? "it waits" : "they wait"} in To file.</span>
        </div>
        <button type="button" className="btn primary" onClick={(e) => keep(e.currentTarget)}>{chosen.length ? `Keep under ${chosen.length === 1 ? ix.topics.get(chosen[0])?.name ?? "1 topic" : `${chosen.length} topics`}` : "Keep without a topic"}</button>
      </div>
    </Sheet>
  );
}
