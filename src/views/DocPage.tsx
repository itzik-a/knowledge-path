/* One file's page: a resource, a note, a journal entry or a study path (#doc/<path>). */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { resolve, topicIdOf, type Doc, type Index } from "../../shared/index.ts";
import { journalDate, journalPath, kindOf, parseHighlights, parseSteps, STATUSES, todayISO, type Highlight, type Status } from "../../shared/vault.ts";
import { DocRow, Progress, STATUS_LABEL, TYPE_EMOJI, TYPE_LABEL, TopicPicker } from "../components/bits";
import { IconBack, IconEdit, IconExternal, IconMore, IconNext, IconQuote, IconRead } from "../components/Icons";
import { Markdown } from "../components/Markdown";
import { NoteBody } from "../components/NoteBody";
import { ResourceSheet } from "../components/ResourceSheet";
import { Menu, Seg, useMedia } from "../components/ui";
import { addDays, longDate, medDate } from "../lib/dates";
import { back, docHref, tagHref, topicHref } from "../lib/route";
import { addHighlight, editHighlight, patchResource, remove, retitle, setStatus, setTopics, toggleStep } from "../state/actions";
import { readFile, useIndex } from "../state/store";


export function DocPage({ path }: { path: string }) {
  const ix = useIndex();
  const d = ix.docs.get(path);
  const kind = kindOf(path);
  if (kind === "journal") return <JournalPage path={path} d={d} ix={ix} />;
  if (!d) return <Missing path={path} />;
  if (d.kind === "topic") return <Redirect to={topicHref(topicIdOf(path))} />;
  if (d.kind === "resource") return <ResourcePage d={d} ix={ix} />;
  if (d.kind === "path") return <PathPage d={d} ix={ix} />;
  return <NotePage d={d} ix={ix} />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => { location.replace(to); }, [to]);
  return null;
}

function Back({ fallback = "#home" }: { fallback?: string }) {
  return (
    <button type="button" className="back link-row" onClick={() => back(fallback)}>
      <IconBack /> Back
    </button>
  );
}

function Missing({ path }: { path: string }) {
  return (
    <>
      <Back />
      <div className="card empty">
        <h2>Not here</h2>
        <p className="muted">There's no <code>{path}</code> in the vault (it may have been removed or renamed on another device).</p>
        <a className="btn" href="#home">Go home</a>
      </div>
    </>
  );
}

function LinkedFrom({ ix, path }: { ix: Index; path: string }) {
  const from = (ix.backlinks.get(path) ?? []).map((p) => ix.docs.get(p)).filter((x): x is Doc => !!x);
  if (!from.length) return null;
  return (
    <section className="card">
      <h2>Linked from</h2>
      <ul className="item-list">{from.map((x) => <DocRow key={x.path} d={x} ix={ix} />)}</ul>
    </section>
  );
}

function Tags({ d }: { d: Doc }) {
  if (!d.tags.length) return null;
  return <div className="chips">{d.tags.map((t) => <a key={t} className="hashtag-chip" href={tagHref(t)}>#{t}</a>)}</div>;
}

function Topics({ ix, d }: { ix: Index; d: Doc }) {
  const named = d.topicRefs.map((r) => {
    for (const id of ix.topicOrder) { const t = ix.topics.get(id)!; if (t.id.toLowerCase() === r.toLowerCase() || t.name.toLowerCase() === r.toLowerCase() || id.toLowerCase().endsWith("/" + r.toLowerCase())) return id; }
    return undefined;
  }).filter((x): x is string => !!x);
  const all = ix.topicsOf.get(d.path) ?? [];
  const fixed = all.filter((id) => !named.includes(id));
  return <TopicPicker value={named} onChange={(ids) => setTopics(d.path, ids)} fixed={fixed} suggested={d.resource?.suggestedTopics.map((n) => [...ix.topics.values()].find((t) => t.name.toLowerCase() === n.toLowerCase() || t.id === n)?.id ?? "") ?? []} />;
}

/** Edit / Done for a body; on a wide screen an empty body starts in the editor. */
function useEditing(empty: boolean) {
  return useState(empty);
}

// ── resource ──────────────────────────────────────────────────
function ResourcePage({ d, ix }: { d: Doc; ix: Index }) {
  const r = d.resource!;
  const [details, setDetails] = useState(false);
  const notesBody = d.body;
  const hasNotes = !!notesBody.replace(/^##\s+highlights[\s\S]*$/im, "").trim();
  const [editing, setEditing] = useEditing(false);
  const articlePath = typeof d.fm.article === "string" ? d.fm.article : undefined;
  const article = articlePath ? readFile(articlePath) : undefined;
  const [reading, setReading] = useState(false);
  const hls = parseHighlights(d.body);

  return (
    <>
      <Back fallback="#library" />
      <section className="card res-head">
        <div className="res-top">
          {r.image ? <img className="res-image" src={r.image} alt="" referrerPolicy="no-referrer" /> : <span className="res-emoji" aria-hidden="true">{TYPE_EMOJI[r.type]}</span>}
          <div className="res-title">
            <span className="eyebrow">{TYPE_LABEL[r.type]}{r.site ? ` · ${r.site}` : ""}</span>
            <h1 className="display" dir="auto">{d.title}</h1>
            {(r.author || r.year) && <p className="muted" dir="auto">{[r.author, r.year].filter(Boolean).join(" · ")}</p>}
          </div>
          <Menu label="More" icon={<IconMore />} items={[
            { label: "Edit details", run: () => setDetails(true) },
            r.url ? { label: "Copy link", run: () => void navigator.clipboard?.writeText(r.url!) } : null,
            r.url ? { label: "Fetch details again", run: () => patchResource(d.path, { enrich: "pending", enrichError: undefined }) } : null,
            { label: "Remove", danger: true, run: () => { remove(d.path); back("#library"); } },
          ]} />
        </div>
        <div className="btn-row">
          {r.url && <a className="btn primary sm" href={r.url} target="_blank" rel="noopener">Open <IconExternal /></a>}
          {article && <button type="button" className="btn sm" aria-pressed={reading} onClick={() => setReading((x) => !x)}><IconRead /> {reading ? "Close reader" : "Read here"}</button>}
          <button type="button" className="btn ghost sm" onClick={() => setDetails(true)}><IconEdit /> Details</button>
        </div>
        {r.enrich === "pending" && r.url && <p className="muted small">Fetching the details: they arrive after the next sync (a minute or two).</p>}
        {r.enrich === "failed" && <p className="muted small">Couldn't read the page{r.enrichError ? ` (${r.enrichError})` : ""}. Add the details by hand.</p>}

        <div className="field">
          <span className="field-label">Status</span>
          <Seg<Status> className="wrap" label="Status" value={r.status} onChange={(s) => setStatus(d.path, s)} options={STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] }))} />
        </div>
        <div className="field">
          <span className="field-label">Topics</span>
          <Topics ix={ix} d={d} />
        </div>
      </section>

      {r.summary && (
        <section className="card">
          <h2>Summary</h2>
          <p dir="auto">{r.summary}</p>
        </section>
      )}

      {reading && article && <Reader path={d.path} text={article} url={r.url} />}

      <section className="card">
        <div className="card-head">
          <h2>My notes</h2>
          <button type="button" className="btn ghost sm" onClick={() => setEditing((x) => !x)}>{editing ? "Done" : hasNotes ? "Edit" : "Write"}</button>
        </div>
        <NoteBody path={d.path} body={d.body} editing={editing} hideHighlights={!editing} autoFocus placeholder="What I think, what I learned, questions… [[link]] anything."
          empty="Nothing yet. What did you think?" />
      </section>

      <Highlights path={d.path} hls={hls} />
      <LinkedFrom ix={ix} path={d.path} />
      <Tags d={d} />
      {details && <ResourceSheet path={d.path} onClose={() => setDetails(false)} />}
    </>
  );
}

/** The saved article text. Select a passage and press Highlight to keep it. */
function Reader({ path, text, url }: { path: string; text: string; url?: string }) {
  const [sel, setSel] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = () => {
      const s = document.getSelection();
      if (!s || s.isCollapsed || !box.current?.contains(s.anchorNode)) { setSel(""); return; }
      setSel(s.toString().trim());
    };
    document.addEventListener("selectionchange", on);
    return () => document.removeEventListener("selectionchange", on);
  }, []);
  return (
    <section className="card reader">
      <div className="card-head">
        <h2>Reader</h2>
        {url && <a className="link small" href={url} target="_blank" rel="noopener">Original <IconExternal /></a>}
      </div>
      <p className="muted small">Select a passage to save it as a highlight.</p>
      <div ref={box}><Markdown body={text} from={path} className="reader-text" /></div>
      {sel && (
        <button type="button" className="btn primary hl-float" onPointerDown={(e) => e.preventDefault()} onClick={() => { addHighlight(path, sel); document.getSelection()?.removeAllRanges(); setSel(""); }}>
          <IconQuote /> Highlight
        </button>
      )}
    </section>
  );
}

function Highlights({ path, hls }: { path: string; hls: Highlight[] }) {
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<number | null>(null);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Highlights{hls.length ? <span className="muted"> · {hls.length}</span> : null}</h2>
        {!adding && <button type="button" className="btn ghost sm" onClick={() => { setAdding(true); setEdit(null); }}><IconQuote /> Add</button>}
      </div>
      {adding && <HighlightForm onSave={(q, c) => { addHighlight(path, q, c); setAdding(false); }} onCancel={() => setAdding(false)} />}
      {!hls.length && !adding && <p className="muted small">Quotes and passages worth keeping. They come back in the daily review on Home.</p>}
      <ul className="hl-list">
        {hls.map((h, i) => (
          <li key={`${h.start}-${h.quote.slice(0, 20)}`}>
            {edit === i ? (
              <HighlightForm quote={h.quote} comment={h.comment} onSave={(q, c) => { editHighlight(path, h, q, c); setEdit(null); }} onCancel={() => setEdit(null)}
                onRemove={() => { editHighlight(path, h, null); setEdit(null); }} />
            ) : (
              <button type="button" className="hl" onClick={() => { setEdit(i); setAdding(false); }}>
                <blockquote dir="auto">{h.quote}</blockquote>
                {h.comment && <p className="muted small" dir="auto">{h.comment}</p>}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HighlightForm({ quote = "", comment = "", onSave, onCancel, onRemove }: { quote?: string; comment?: string; onSave: (q: string, c?: string) => void; onCancel: () => void; onRemove?: () => void }) {
  const [q, setQ] = useState(quote);
  const [c, setC] = useState(comment);
  function save(e: FormEvent) { e.preventDefault(); if (q.trim()) onSave(q.trim(), c.trim() || undefined); }
  return (
    <form className="form-grid sub-form" onSubmit={save}>
      <textarea className="text-input" dir="auto" rows={3} autoFocus placeholder="The quote or passage" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Quote" />
      <textarea className="text-input" dir="auto" rows={2} placeholder="My comment (optional)" value={c} onChange={(e) => setC(e.target.value)} aria-label="Comment" />
      <div className="btn-row">
        <button type="submit" className="btn primary sm" disabled={!q.trim()}>Save</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
        {onRemove && <button type="button" className="btn ghost sm danger" onClick={onRemove}>Remove</button>}
      </div>
    </form>
  );
}

// ── note ──────────────────────────────────────────────────────
function TitleInput({ d }: { d: Doc }) {
  const [v, setV] = useState(d.title);
  useEffect(() => setV(d.title), [d.title]);
  const commit = () => {
    if (v.trim() && v.trim() !== d.title) { const next = retitle(d.path, v); if (next !== d.path) history.replaceState(history.state, "", docHref(next)); window.dispatchEvent(new HashChangeEvent("hashchange")); }
    else setV(d.title);
  };
  return (
    <input className="title-input display" dir="auto" value={v} aria-label="Title" onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") { setV(d.title); (e.target as HTMLInputElement).blur(); } }} />
  );
}

function NotePage({ d, ix }: { d: Doc; ix: Index }) {
  const wide = useMedia("(min-width: 768px)");
  const [editing, setEditing] = useEditing(!d.body.trim() || wide);
  const folder = d.path.includes("/") ? d.path.slice(0, d.path.lastIndexOf("/")) : "";
  return (
    <>
      <Back fallback="#notes" />
      <section className="card note-card-main">
        <div className="note-head">
          <div className="grow">
            <span className="eyebrow">{folder || "Vault"}{typeof d.fm.created === "string" ? ` · ${medDate(d.fm.created)}` : ""}</span>
            <TitleInput d={d} />
          </div>
          <Menu label="More" icon={<IconMore />} items={[
            { label: editing ? "Read" : "Edit", run: () => setEditing((x) => !x) },
            { label: "Remove", danger: true, run: () => { remove(d.path); back("#notes"); } },
          ]} />
        </div>
        <Topics ix={ix} d={d} />
        <div className="body-wrap">
          <div className="body-tools">
            <button type="button" className="btn ghost sm" onClick={() => setEditing((x) => !x)}>{editing ? "Done" : "Edit"}</button>
          </div>
          <NoteBody path={d.path} body={d.body} editing={editing} autoFocus={!d.body.trim()} placeholder="Write… [[ links a note or topic, # adds a tag." />
        </div>
        <Tags d={d} />
      </section>
      <LinkedFrom ix={ix} path={d.path} />
    </>
  );
}

// ── journal ───────────────────────────────────────────────────
function JournalPage({ path, d, ix }: { path: string; d?: Doc; ix: Index }) {
  const date = journalDate(path) ?? todayISO();
  const today = todayISO();
  const [editing, setEditing] = useEditing(!d?.body.trim());
  const body = d?.body ?? "";
  return (
    <>
      <div className="row-between">
        <a className="back link-row" href="#notes/journal"><IconBack /> Journal</a>
        <div className="day-nav">
          <a className="icon-btn subtle" href={docHref(journalPath(addDays(date, -1)))} aria-label="Day before"><IconBack /></a>
          {date !== today && <a className="btn ghost sm" href={docHref(journalPath(today))}>Today</a>}
          <a className="icon-btn subtle" href={docHref(journalPath(addDays(date, 1)))} aria-label="Day after"><IconNext /></a>
        </div>
      </div>
      <section className="card note-card-main">
        <div className="note-head">
          <div className="grow">
            <span className="eyebrow">{date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : "Journal"}</span>
            <h1 className="display">{longDate(date)}</h1>
          </div>
          {d && <Menu label="More" icon={<IconMore />} items={[{ label: "Remove this entry", danger: true, run: () => remove(path, `the entry for ${longDate(date)}`) }]} />}
        </div>
        {d && <Topics ix={ix} d={d} />}
        <div className="body-wrap">
          <div className="body-tools">
            <button type="button" className="btn ghost sm" onClick={() => setEditing((x) => !x)}>{editing ? "Done" : "Edit"}</button>
          </div>
          <NoteBody key={path} path={path} body={body} editing={editing} autoFocus={!body.trim()}
            placeholder="How was today? What did you read, think, notice? [[Stoicism]] puts this entry under that topic." />
        </div>
        {d && <Tags d={d} />}
      </section>
      {d && <LinkedFrom ix={ix} path={path} />}
    </>
  );
}

// ── study path ────────────────────────────────────────────────
function PathPage({ d, ix }: { d: Doc; ix: Index }) {
  const steps = parseSteps(d.body);
  const done = steps.filter((s) => s.done).length;
  const [editing, setEditing] = useEditing(steps.length <= 1 && !steps[0]?.text);
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const desc = typeof d.fm.description === "string" ? d.fm.description : undefined;
  const intro = d.body.split("\n").filter((l) => !/^\s*[-*+] \[[ xX]\]/.test(l)).join("\n");
  return (
    <>
      <Back fallback="#topics" />
      <section className="card">
        <div className="note-head">
          <div className="grow">
            <span className="eyebrow">Study path</span>
            <TitleInput d={d} />
            {desc && <p className="muted" dir="auto">{desc}</p>}
          </div>
          <Menu label="More" icon={<IconMore />} items={[
            { label: editing ? "Show steps" : "Edit steps", run: () => setEditing((x) => !x) },
            { label: "Remove", danger: true, run: () => { remove(d.path); back("#topics"); } },
          ]} />
        </div>
        <Topics ix={ix} d={d} />
        {steps.length > 0 && (
          <div className="path-progress">
            <Progress value={pct} />
            <span className="muted small">{done} of {steps.length} done</span>
          </div>
        )}
      </section>
      <section className="card">
        <div className="card-head">
          <h2>Steps</h2>
          <button type="button" className="btn ghost sm" onClick={() => setEditing((x) => !x)}>{editing ? "Done" : "Edit"}</button>
        </div>
        {editing ? (
          <>
            <p className="muted small">One step per line: <code>- [ ] [[Meditations]]: books 2–4</code>. Type <code>[[</code> to pick a resource or note.</p>
            <NoteBody path={d.path} body={d.body} editing autoFocus />
          </>
        ) : (
          <>
            {intro.trim() && <Markdown body={intro} from={d.path} />}
            <ol className="steps-list">
              {steps.map((s) => {
                const target = s.link ? resolve(ix, s.link, d.path) : undefined;
                const td = target ? ix.docs.get(target) : undefined;
                const rest = s.text.replace(/\[\[[^\]]+\]\]:?\s*/, "").trim();
                return (
                  <li key={s.line} className={s.done ? "done" : undefined}>
                    <input type="checkbox" className="task-box" checked={s.done} onChange={() => toggleStep(d.path, s.line)} aria-label={`Done: ${td?.title ?? s.text}`} />
                    <div className="step-main">
                      {td ? (
                        <a href={docHref(td.path)} className="step-link" dir="auto">
                          {td.resource && <span aria-hidden="true">{TYPE_EMOJI[td.resource.type]} </span>}{td.title}
                          {td.resource && td.resource.status !== "saved" && <span className="muted small"> · {STATUS_LABEL[td.resource.status]}</span>}
                        </a>
                      ) : s.link ? <span dir="auto">{s.link}</span> : null}
                      {(rest || !s.link) && <span className={s.link ? "muted small" : undefined} dir="auto">{s.link ? rest : s.text}</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>
      <LinkedFrom ix={ix} path={d.path} />
    </>
  );
}
