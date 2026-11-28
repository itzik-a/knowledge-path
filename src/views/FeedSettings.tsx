/* Feed settings (#inbox/feed/settings): running the collector (Run now, the last runs and what they cost, automatic
   runs), days to keep unreviewed entries, the feed topics with their thresholds, the sources with how their last
   read went, and what was filtered out (to tune thresholds). Everything here is .hub/feed/settings.json in the vault,
   except what the collector reports (the feed branch). */
import { useState, type FormEvent } from "react";
import { costUsd, spentThisMonth, type Edition, type Source, type SourceHealth, type SourceKind } from "../../shared/feed.ts";
import { IconBack, IconVideo } from "../components/Icons";
import { Seg, Sheet, Stepper, Switch, closeSheet } from "../components/ui";
import {
  addSource, addTopic, deleteSource, deleteTopic, editSource, editTopic, setKeepDays, sourceFromUrl,
  useFeed, useFeedSettings,
} from "../state/feed";
import { showToast } from "../lib/toast";
import { AutoRunsCard } from "./FeedAuto";
import { RunButton, ago } from "./Feed";

const GROUPS: { kind: SourceKind; label: string }[] = [
  { kind: "youtube", label: "YouTube channels" },
  { kind: "rss", label: "Sites & feeds" },
  { kind: "search", label: "News searches" },
];
const EDITIONS: { id: Edition; label: string }[] = [{ id: "en-US", label: "English" }, { id: "he-IL", label: "Hebrew" }];
const DAY = 86_400_000;
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const KIND: Record<string, string> = { request: "Run now", manual: "by hand", scheduled: "automatic" };

function healthLine(h: SourceHealth | undefined, s: Source) {
  if (!s.enabled) return { text: "Off", bad: false };
  if (!h) return { text: "Read on the next run", bad: false };
  if (!h.ok) return { text: h.error ?? "Failed on the last run", bad: true };
  return { text: `${h.newItems} new when last read, ${ago(h.lastRun)}`, bad: false };
}

export function FeedSettingsPage() {
  const settings = useFeedSettings();
  const { feed } = useFeed();
  const runs = feed?.runs ?? [];
  const spent = spentThisMonth(feed);
  return (
    <>
      <a className="back" href="#inbox/feed"><IconBack /> Feed</a>
      <div className="page-head"><h1 className="display">Feed settings</h1></div>

      <section className="card" aria-labelledby="fs-runs">
        <div className="card-head">
          <h2 id="fs-runs">Runs</h2>
          <RunButton />
        </div>
        <p className="muted small">
          A run reads every source, has Claude (Haiku) score what's new against your feed topics, and summarizes what passes. Run now takes 2–4 minutes; it never sends anything anywhere.
          {feed && <> Claude cost ${spent.toFixed(2)} this month.</>}
        </p>
        {runs.length > 0 && (
          <ul className="run-list">
            {runs.slice(0, 8).map((r) => (
              <li key={r.at}>
                <span>{new Date(r.at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} <span className="muted small">· {KIND[r.kind ?? ""] ?? "run"}{r.slot ? ` ${r.slot}` : ""}</span></span>
                <span className="muted small">{r.added} new · {r.merged} joined a story · {r.dropped} filtered{r.tokens ? ` · $${costUsd(r.tokens).toFixed(3)}` : ""}{r.errors.length ? ` · ${r.errors.length} errors` : ""}</span>
                {r.errors.length > 0 && <details className="small"><summary className="muted">Errors</summary><ul>{r.errors.map((e, i) => <li key={i} className="muted">{e}</li>)}</ul></details>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <AutoRunsCard />

      <section className="card" aria-labelledby="fs-keep">
        <h2 id="fs-keep">Keeping</h2>
        <Stepper label="Days to keep" value={settings.keepDays} min={2} max={30} step={1} unit=" days" onChange={setKeepDays} />
        <p className="muted small">Entries you haven't kept or dismissed leave the feed after this. Kept ones are saved links, so they stay.</p>
      </section>

      <Topics />
      <Sources />

      {feed && feed.filtered.length > 0 && (
        <details className="card year-table">
          <summary><h2>Filtered out</h2><span className="muted small">{feed.filtered.length} in 2 days</span></summary>
          <p className="muted small">Headlines that scored under every topic's threshold. If good ones land here, lower that topic's threshold.</p>
          <ul className="filtered-list">
            {feed.filtered.slice(0, 120).map((f, i) => {
              const t = settings.topics.find((x) => x.id === f.topic);
              return (
                <li key={i}>
                  <a href={/^https?:/i.test(f.url) ? f.url : undefined} target="_blank" rel="noopener noreferrer" dir="auto">{f.title}</a>
                  <span className="muted small">{f.sourceName} · {t ? `${t.name} ${f.score}` : `best ${f.score}`}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </>
  );
}

function Topics() {
  const settings = useFeedSettings();
  const { feed } = useFeed();
  const topics = settings.topics.filter((t) => !t.deletedAt);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const since = Date.now() - DAY;
  return (
    <section className="feed-settings-group" aria-labelledby="fs-topics">
      <div className="card-head">
        <h2 id="fs-topics">Feed topics</h2>
        <button type="button" className="btn ghost sm" onClick={() => setAdding(true)}>New topic</button>
      </div>
      <p className="muted small">What the feed is about, in your words (not your knowledge-base topics). Every new item is scored 0–100 for each; it reaches the feed when it meets a topic's threshold. 30 related but routine · 50 worth a look · 70 important · 85 a major development.</p>
      {topics.map((t) => {
        const inFeed = feed?.entries.filter((e) => e.createdAt >= since && e.topics.some((x) => x.topic === t.id && x.score >= t.minScore)).length ?? 0;
        const out = feed?.filtered.filter((f) => f.topic === t.id).length ?? 0;
        return (
          <article key={t.id} className={`card feed-topic${t.enabled ? "" : " off"}`}>
            <div className="card-head">
              <h3 dir="auto">{t.name}</h3>
              <Switch on={t.enabled} label={`${t.name} on`} onChange={(on) => editTopic(t.id, (x) => { x.enabled = on; })} />
            </div>
            <p className="muted small" dir="auto">{t.description}</p>
            <div className="feed-topic-foot">
              <Stepper label="Threshold" value={t.minScore} min={20} max={95} step={5} onChange={(v) => editTopic(t.id, (x) => { x.minScore = v; })} />
              {feed && <p className="small muted">{inFeed} in the feed from the last day · {out} filtered out in 2 days</p>}
            </div>
            <button type="button" className="text-btn" onClick={() => setEditing(t.id)}>Edit</button>
          </article>
        );
      })}
      {editing && <TopicSheet id={editing} onClose={() => setEditing(null)} />}
      {adding && <NewTopicSheet onClose={() => setAdding(false)} />}
    </section>
  );
}

function TopicSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useFeedSettings().topics.find((x) => x.id === id);
  const [name, setName] = useState(t?.name ?? "");
  const [desc, setDesc] = useState(t?.description ?? "");
  if (!t) return null;
  const save = () => { if (name.trim() !== t.name || desc.trim() !== t.description) editTopic(t.id, (x) => { x.name = name.trim() || x.name; x.description = desc.trim() || x.description; }); };
  return (
    <Sheet title={t.name} onClose={() => { save(); onClose(); }}>
      <div className="form-grid">
        <label className="field"><span className="field-label">Name</span><input className="text-input" value={name} onChange={(e) => setName(e.target.value)} dir="auto" /></label>
        <label className="field">
          <span className="field-label">What you care about</span>
          <textarea className="text-input" rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} dir="auto" />
          <span className="muted small">Claude reads this to score items. Say what to prefer and what to leave out.</span>
        </label>
        <button type="button" className="btn ghost danger" onClick={(e) => { deleteTopic(t.id); closeSheet(e.currentTarget); }}>Remove topic</button>
      </div>
    </Sheet>
  );
}

function NewTopicSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || !desc.trim()) return;
    addTopic(name, desc);
    closeSheet(e.currentTarget);
  }
  return (
    <Sheet title="New feed topic" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label className="field"><span className="field-label">Name</span><input className="text-input" value={name} onChange={(e) => setName(e.target.value)} dir="auto" data-autofocus /></label>
        <label className="field">
          <span className="field-label">What you care about</span>
          <textarea className="text-input" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} dir="auto" placeholder="e.g. New AI models and research results; skip funding rounds and product marketing." />
        </label>
        <p className="muted small">A topic scores items from every source. To get items it needs, add sources that cover it (a site, a channel or a news search).</p>
        <button className="btn primary" type="submit" disabled={!name.trim() || !desc.trim()}>Add topic</button>
      </form>
    </Sheet>
  );
}

function Sources() {
  const settings = useFeedSettings();
  const { feed } = useFeed();
  const sources = settings.sources.filter((s) => !s.deletedAt);
  const topics = new Map(settings.topics.map((t) => [t.id, t]));
  const [url, setUrl] = useState("");
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const health = feed?.health ?? {};
  const failing = sources.filter((s) => s.enabled && health[s.id] && !health[s.id].ok).length;

  function add(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    const guess = sourceFromUrl(url);
    const id = addSource(guess);
    setUrl("");
    showToast(`Added ${guess.name}`);
    setEditing(id);
  }

  return (
    <section className="feed-settings-group" aria-labelledby="fs-sources">
      <div className="card-head"><h2 id="fs-sources">Sources</h2></div>
      <p className="muted small">{sources.filter((s) => s.enabled).length} on{failing ? ` · ${failing} failing` : ""}.</p>
      <form className="card add-source" onSubmit={add}>
        <label className="field">
          <span className="field-label">Add a YouTube channel, site or feed</span>
          <span className="add-source-row">
            <input className="text-input" type="text" inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="youtube.com/@name, a site or feed" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn primary sm" type="submit" disabled={!url.trim()}>Add</button>
          </span>
        </label>
        <button type="button" className="text-btn" onClick={() => setSearching(true)}>Or follow a Google News search…</button>
      </form>
      {GROUPS.map(({ kind, label }) => {
        const list = sources.filter((s) => s.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className="source-group">
            <h3 className="eyebrow">{label}</h3>
            <ul className="card source-list">
              {list.map((s) => {
                const h = healthLine(health[s.id], s);
                return (
                  <li key={s.id} className={`source-row${s.enabled ? "" : " off"}`}>
                    <button type="button" className="source-main" onClick={() => setEditing(s.id)}>
                      <span className="source-name">{s.kind === "youtube" && <IconVideo />}<span dir="auto">{s.name}</span></span>
                      <span className="muted small" dir="auto">{s.kind === "search" ? `“${s.query}” · ${s.edition === "he-IL" ? "Hebrew" : "English"}` : host(s.url ?? "")}</span>
                      <span className={`small ${h.bad ? "form-error" : "muted"}`}>{h.text}</span>
                      {!!s.topics?.length && <span className="mini-tags">{s.topics.map((t) => topics.get(t)).filter((t) => t && !t.deletedAt).map((t) => <span key={t!.id} className="tag">{t!.name}</span>)}</span>}
                    </button>
                    <Switch on={s.enabled} label={`${s.name} on`} onChange={(on) => editSource(s.id, (x) => { x.enabled = on; })} />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {editing && <SourceSheet id={editing} onClose={() => setEditing(null)} />}
      {searching && <SearchSheet onClose={() => setSearching(false)} />}
    </section>
  );
}

function FeedTopicChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const topics = useFeedSettings().topics.filter((t) => !t.deletedAt);
  return (
    <div className="chips" role="group" aria-label="Feed topics">
      {topics.map((t) => {
        const on = value.includes(t.id);
        return <button key={t.id} type="button" className="chip" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}>{t.name}</button>;
      })}
    </div>
  );
}

function SourceSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useFeedSettings().sources.find((x) => x.id === id);
  const { feed } = useFeed();
  const [name, setName] = useState(s?.name ?? "");
  const [url, setUrl] = useState(s?.url ?? "");
  const [query, setQuery] = useState(s?.query ?? "");
  if (!s) return null;
  const h = feed?.health[s.id];
  const save = () => {
    const changed = name.trim() !== s.name || (s.kind === "search" ? query.trim() !== (s.query ?? "") : url.trim() !== (s.url ?? ""));
    if (changed) editSource(s.id, (x) => { x.name = name.trim() || x.name; if (x.kind === "search") x.query = query.trim() || x.query; else x.url = url.trim() || x.url; });
  };
  return (
    <Sheet title={s.name} onClose={() => { save(); onClose(); }}>
      <div className="form-grid">
        <label className="field"><span className="field-label">Name</span><input className="text-input" value={name} onChange={(e) => setName(e.target.value)} dir="auto" /></label>
        {s.kind === "search" ? (
          <>
            <label className="field"><span className="field-label">Search phrase</span><input className="text-input" value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" /></label>
            <Seg<Edition> label="Edition" value={s.edition ?? "en-US"} options={EDITIONS} onChange={(v) => editSource(s.id, (x) => { x.edition = v; })} />
          </>
        ) : (
          <label className="field">
            <span className="field-label">{s.kind === "youtube" ? "Channel URL" : "Site or feed URL"}</span>
            <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" spellCheck={false} />
            {h?.feedUrl && h.feedUrl !== url && <span className="muted small">Reading {h.feedUrl}</span>}
          </label>
        )}
        <div className="field">
          <span className="field-label">Usually about</span>
          <FeedTopicChips value={s.topics ?? []} onChange={(v) => editSource(s.id, (x) => { x.topics = v; })} />
          <span className="muted small">A hint for scoring. Items are still scored against every feed topic.</span>
        </div>
        <label className="switch-row"><Switch on={s.enabled} label="Source on" onChange={(on) => editSource(s.id, (x) => { x.enabled = on; })} /><span>On</span></label>
        {h && <p className={`small ${h.ok ? "muted" : "form-error"}`}>{h.ok ? `Last read ${ago(h.lastRun)}: ${h.items} items in its feed, ${h.newItems} new.` : `Last read ${ago(h.lastRun)}: ${h.error}`}</p>}
        <button type="button" className="btn ghost danger" onClick={(e) => { deleteSource(s.id); closeSheet(e.currentTarget); }}>Remove source</button>
      </div>
    </Sheet>
  );
}

function SearchSheet({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [edition, setEdition] = useState<Edition>("en-US");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!query.trim()) return;
    addSource({ kind: "search", name: `Google News · ${query.trim()}`, query, edition, topics: topicIds });
    showToast("Search added");
    closeSheet(e.currentTarget);
  }
  return (
    <Sheet title="Follow a news search" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <p className="muted small">Google News headlines for a phrase. Only the headline can be read (Google's links don't open the article), so these summaries are short. Quotes and OR work: <code>"gene therapy" OR senolytics</code>.</p>
        <label className="field"><span className="field-label">Search phrase</span><input className="text-input" value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" data-autofocus /></label>
        <Seg<Edition> label="Edition" value={edition} options={EDITIONS} onChange={setEdition} />
        <div className="field"><span className="field-label">Usually about</span><FeedTopicChips value={topicIds} onChange={setTopicIds} /></div>
        <button className="btn primary" type="submit" disabled={!query.trim()}>Add search</button>
      </form>
    </Sheet>
  );
}
