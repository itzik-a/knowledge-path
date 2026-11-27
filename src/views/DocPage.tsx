/* One file's page: a resource, a note, a journal entry, a study path, a habit, a recipe or a book's chapter (#doc/<path>). */
import { confirmAsk } from "../lib/confirm";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { resolve, topicIdOf, type Doc, type Index } from "../../shared/index.ts";
import { journalDate, journalPath, kindOf, parseHighlights, parseSteps, STATUSES, todayISO, type Highlight, type Status } from "../../shared/vault.ts";
import { DocRow, Progress, QuoteText, STATUS_LABEL, TYPE_EMOJI, TYPE_LABEL, TopicPicker } from "../components/bits";
import { IconBook, IconCheck, IconSpark, IconRecipe, IconBack, IconEdit, IconExternal, IconLock, IconMore, IconPin, IconUnlock, IconNext, IconQuote, IconRead, IconSketch, IconGraph, IconCards } from "../components/Icons";
import { Markdown } from "../components/Markdown";
import { NoteBody } from "../components/NoteBody";
import { ReadingButton } from "../components/ReadingPanel";
import { OutlineButton } from "../components/editor/outline";
import { ResourceSheet } from "../components/ResourceSheet";
import { Menu, Seg } from "../components/ui";
import { addDays, longDate, medDate } from "../lib/dates";
import { back, docHref, go, graphHref, tagHref, topicHref } from "../lib/route";
import { openSheet } from "../lib/sheets";
import { addChapterHighlight, addHighlight, deleteDocs, editHighlight, inboxItem, makeBook, makeRecipe, pinItem, requestEpub, requestSummary, patchResource, retitle, setPinned, setStatus, setTopics, toggleStep } from "../state/actions";
import { useSummariesAuto } from "../state/settings";
import { readFile, useIndex, useVault } from "../state/store";
import { isCard, readCards, setCard } from "../state/cards";
import { mb, usePdfState, type PdfState } from "../state/pdfs";
import { pageOf, pdfOf } from "../../shared/pdfs.ts";
import type { CardMap } from "../../shared/cards.ts";
import { amountText, habitIcon } from "../components/habits";
import { HabitPage } from "./Habits";
import { RecipePage } from "./Recipes";
import { LockedBody, PrivateBadge } from "../components/PrivateNotes";
import { getPassphrase } from "../lib/passphrase";
import { setPrivate } from "../state/privacy";
import { bookOf, chaptersIn, isRsarchive, plainLinks, readingText, sectionsOf } from "../../shared/books.ts";
import { EpubButton, EpubStatus } from "../components/Epub";
import { useHeldSelection } from "../lib/selection";


export function DocPage({ path }: { path: string }) {
  const ix = useIndex();
  const d = ix.docs.get(path);
  const kind = kindOf(path);
  if (kind === "journal") return <JournalPage path={path} d={d} ix={ix} />;
  if (!d) return <Missing path={path} />;
  if (d.kind === "topic") return <Redirect to={topicHref(topicIdOf(path))} />;
  if (d.kind === "resource") return <ResourcePage d={d} ix={ix} />;
  if (d.kind === "path") return <PathPage d={d} ix={ix} />;
  if (d.kind === "habit") return <HabitPage d={d} ix={ix} />;
  if (d.kind === "recipe") return <RecipePage d={d} ix={ix} />;
  if (d.kind === "chapter") return <ChapterPage d={d} ix={ix} />;
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

export function LinkedFrom({ ix, path, skip }: { ix: Index; path: string; skip?: (d: Doc) => boolean }) {
  const from = (ix.backlinks.get(path) ?? []).map((p) => ix.docs.get(p)).filter((x): x is Doc => !!x && !skip?.(x));
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

/** Pin / unpin, for the note and journal pages' tools. */
function PinButton({ d }: { d: Doc }) {
  const label = d.pinned ? "Unpin" : "Pin";
  return (
    <button type="button" className={`icon-btn subtle${d.pinned ? " on" : ""}`} aria-pressed={!!d.pinned} aria-label={label} title={label} onClick={() => setPinned(d.path, !d.pinned)}>
      <IconPin />
    </button>
  );
}

/** This note's local graph (what links to it and what it links to). */
function GraphButton({ path }: { path: string }) {
  return (
    <a className="icon-btn subtle" href={graphHref(path)} aria-label="Local graph" title="Local graph"><IconGraph /></a>
  );
}

/** Draw a sketch and put it in this note (at the cursor while editing, else at the end). */
function SketchButton({ note }: { note: string }) {
  return (
    <button type="button" className="icon-btn subtle" onClick={() => openSheet({ kind: "sketch", note })} aria-label="Add a sketch" title="Add a sketch">
      <IconSketch />
    </button>
  );
}

/** Lock / unlock (private: true). On a new, empty note (or a journal day not written yet) it's locked before a word is typed. */
function PrivateButton({ path, on }: { path: string; on: boolean }) {
  const toggle = async () => {
    if (on) {
      if (await confirmAsk({ title: "Unlock this note?", body: "Its text goes to the vault unencrypted, readable by anyone who can open the repo.", ok: "Unlock" })) void setPrivate(path, false);
    } else if (!getPassphrase()) openSheet({ kind: "private", then: path });
    else void setPrivate(path, true);
  };
  const label = on ? "Locked: encrypted in the vault. Unlock" : "Lock: encrypt it in the vault";
  return (
    <button type="button" className={`icon-btn subtle${on ? " on" : ""}`} aria-pressed={on} aria-label={label} title={label} onClick={() => void toggle()}>
      {on ? <IconLock /> : <IconUnlock />}
    </button>
  );
}

function useEditing(empty: boolean) {
  return useState(empty);
}

/** Edit / Done as an icon: a pencil while reading, a check while editing. */
function EditToggle({ editing, set, write }: { editing: boolean; set: (f: (x: boolean) => boolean) => void; write?: boolean }) {
  const label = editing ? "Done" : write ? "Write" : "Edit";
  return (
    <button type="button" className={`icon-btn subtle${editing ? " on" : ""}`} aria-pressed={editing} aria-label={label} title={label} onClick={() => set((x) => !x)}>
      {editing ? <IconCheck /> : <IconEdit />}
    </button>
  );
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
  const toRecipe = () => { const to = makeRecipe(d.path); if (to) { history.replaceState(history.state, "", docHref(to)); window.dispatchEvent(new HashChangeEvent("hashchange")); } };
  const book = bookOf(d.fm);
  const canBook = isRsarchive(r.url);
  // Claude never reads rsarchive.org pages (its robots.txt); "Summarise" is for every other link
  const canSummarise = !!r.url && !canBook && r.summarize !== "pending";
  const autoSummaries = useSummariesAuto();
  // a summary Claude wrote (`summarized:` date), not just the page's own description; links enriched before the
  // setting existed had Claude summaries whenever they have one
  const aiSummary = !!d.fm.summarized || (autoSummaries && !!r.summary);
  const pdf = pdfOf(d.fm);
  const pdfState = usePdfState(pdf);

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
            pinItem(d),
            inboxItem(d),
            { label: "Show in graph", run: () => go(graphHref(d.path)) },
            { label: "Edit details", run: () => setDetails(true) },
            r.url ? { label: "Copy link", run: () => void navigator.clipboard?.writeText(r.url!) } : null,
            r.url ? { label: "Fetch details again", run: () => patchResource(d.path, { enrich: "pending", enrichError: undefined }) } : null,
            canSummarise ? { label: r.summary ? "Summarise again with Claude" : "Summarise with Claude", run: () => requestSummary(d.path) } : null,
            canBook ? { label: book.state === "ready" || book.state === "failed" ? "Fetch the book again" : "Make it a book", run: () => makeBook(d.path) } : null,
            canBook ? { label: "Download as EPUB", run: () => requestEpub(r.url!, d.title) } : null,
            canBook ? null : { label: "Make it a recipe", run: toRecipe },
            { label: "Delete", danger: true, run: async () => { if (await deleteDocs([d.path])) back("#library"); } },
          ]} />
        </div>
        <div className="btn-row">
          {pdf && !(pdfState.kind === "missing" && d.fm.pdfLocal) && <button type="button" className="btn primary sm" onClick={() => openSheet({ kind: "pdf", path: d.path })}><IconRead /> Read</button>}
          {r.url && <a className={`btn ${pdf ? "" : "primary "}sm`} href={r.url} target="_blank" rel="noopener">Open <IconExternal /></a>}
          {article && <button type="button" className="btn sm" aria-pressed={reading} onClick={() => setReading((x) => !x)}><IconRead /> {reading ? "Close reader" : "Read here"}</button>}
          <button type="button" className="btn ghost sm" onClick={() => setDetails(true)}><IconEdit /> Details</button>
          {canSummarise && !autoSummaries && !aiSummary && <button type="button" className="btn ghost sm" onClick={() => requestSummary(d.path)}><IconSpark /> Summarise</button>}
        </div>
        {pdf && <PdfStatus state={pdfState} fm={d.fm} />}
        {r.enrich === "pending" && r.url && <p className="muted small">Fetching the details: they arrive after the next sync (a minute or two).</p>}
        {r.enrich === "failed" && <p className="muted small">Couldn't read the page{r.enrichError ? ` (${r.enrichError})` : ""}. Add the details by hand.</p>}
        {r.summarize === "pending" && <p className="muted small">Claude is summarising it: the summary arrives after the next sync (a minute or two).</p>}
        {canBook && !book.state && (
          <div className="recipe-nudge">
            <span className="grow"><b>This is on the Rudolf Steiner Archive.</b> <span className="muted">Make it a book to read and highlight it here, chapter by chapter (the text goes in the vault), or just get the EPUB (nothing is kept).</span></span>
            <button type="button" className="btn primary sm" onClick={() => makeBook(d.path)}><IconBook /> Make it a book</button>
            <EpubButton url={r.url!} title={d.title} />
          </div>
        )}
        {canBook && <EpubStatus url={r.url!} />}
        {book.state === "pending" && <p className="muted small">Fetching the book from rsarchive.org: it arrives after a sync, in a few minutes (a second a page).</p>}
        {book.state === "failed" && <p className="muted small">Couldn't make the book{book.error ? ` (${book.error})` : ""}. A contents page or a chapter of the edition you want works best as the link.</p>}
        {d.fm.recipe === true && !canBook && (
          <div className="recipe-nudge">
            <span className="grow"><b>There's a recipe on this page.</b> <span className="muted">Make it a recipe to scale it and cook from it.</span></span>
            <button type="button" className="btn primary sm" onClick={toRecipe}><IconRecipe /> Make it a recipe</button>
          </div>
        )}

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

      {reading && article && <Reader text={article} url={r.url} from={d.path} onHighlight={(q) => addHighlight(d.path, q)} />}
      {book.state === "ready" && book.folder && <BookChapters ix={ix} folder={book.folder} url={r.url} title={d.title} note={book.error} />}

      <section className="card">
        <div className="card-head">
          <h2>My notes</h2>
          <EditToggle editing={editing} set={setEditing} write={!hasNotes} />
        </div>
        <NoteBody path={d.path} body={d.body} editing={editing} hideHighlights={!editing} autoFocus placeholder="What I think, what I learned, questions… [[link]] anything."
          empty="Nothing yet. What did you think?" />
      </section>

      <Highlights path={d.path} hls={hls} pdf={!!pdf} />
      <LinkedFrom ix={ix} path={d.path} skip={(x) => x.kind === "chapter" && !!book.folder && x.path.startsWith(book.folder + "/")} />
      <Tags d={d} />
      {details && <ResourceSheet path={d.path} onClose={() => setDetails(false)} />}
    </>
  );
}

/** Select a passage, press Highlight: `onHighlight` gets it, with the block id (^p12) of the paragraph it starts in. */
function useHighlighter(onHighlight: (quote: string, block?: string) => void) {
  const box = useRef<HTMLDivElement>(null);
  const { sel, buttonProps } = useHeldSelection(box, (s) => {
    const text = s.toString().trim();
    if (!text) return null;
    const at = s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement;
    return { text, block: at?.closest("[data-block]")?.getAttribute("data-block") ?? undefined };
  });
  const button = sel ? (
    <button type="button" className="btn primary hl-float" {...buttonProps((v) => onHighlight(v.text.replace(/^\[\d[\w.]*\]\s*/, ""), v.block))}>
      <IconQuote /> Highlight
    </button>
  ) : null;
  return { box, button };
}

/** The saved article text. Select a passage and press Highlight to keep it. */
function Reader({ text, url, from, onHighlight }: { text: string; url?: string; from: string; onHighlight: (quote: string) => void }) {
  const { box, button } = useHighlighter(onHighlight);
  return (
    <section className="card reader">
      <div className="card-head">
        <h2>Reader</h2>
        <span className="reader-tools">
          {url && <a className="link small" href={url} target="_blank" rel="noopener">Original <IconExternal /></a>}
          <ReadingButton />
        </span>
      </div>
      <p className="muted small">Select a passage to save it as a highlight.</p>
      <div ref={box}><Markdown body={text} from={from} className="reader-text" /></div>
      {button}
    </section>
  );
}

// ── books ─────────────────────────────────────────────────────
/** A book's chapters on its saved link's page, by part; its EPUB on request. */
function BookChapters({ ix, folder, url, title, note }: { ix: Index; folder: string; url?: string; title: string; note?: string }) {
  const chapters = chaptersIn(ix, folder);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Chapters{chapters.length ? <span className="muted"> · {chapters.length}</span> : null}</h2>
        {url && <EpubButton url={url} title={title} />}
      </div>
      {!chapters.length && <p className="muted small">The chapters are on their way: they come with the next sync.</p>}
      {note && <p className="muted small">{note}.</p>}
      {sectionsOf(chapters).map((s, i) => (
        <div key={s.heading ?? i} className="book-part">
          {s.heading && <h3 className="book-part-head" dir="auto">{s.heading}</h3>}
          <ol className="chapter-list">
            {s.chapters.map((c) => (
              <li key={c.path}>
                <a className="chapter-row" href={docHref(c.path)}>
                  <span className="grow" dir="auto">{c.title}</span>
                  {(c.chapter?.date || c.chapter?.place) && <span className="muted small">{[c.chapter.date ? medDate(c.chapter.date) : "", c.chapter.place].filter(Boolean).join(", ")}</span>}
                </a>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

/** A chapter of a book: its text to read and highlight (into the book's highlights), and the chapters either side. */
function ChapterPage({ d, ix }: { d: Doc; ix: Index }) {
  const info = d.chapter!;
  const home = info.book ? resolve(ix, info.book, d.path) : undefined;
  const homeDoc = home ? ix.docs.get(home) : undefined;
  const folder = d.path.slice(0, d.path.lastIndexOf("/"));
  const all = chaptersIn(ix, folder);
  const at = all.findIndex((c) => c.path === d.path);
  const prev = at > 0 ? all[at - 1] : undefined;
  const next = at >= 0 ? all[at + 1] : undefined;
  const { box, button } = useHighlighter((q, block) => addChapterHighlight(d.path, q, block));
  useEffect(() => { window.scrollTo(0, 0); }, [d.path]);
  const meta = [info.date ? longDate(info.date) : "", info.place].filter(Boolean).join(", ");
  return (
    <>
      <Back fallback={home ? docHref(home) : "#library"} />
      <section className="card chapter-head">
        <span className="eyebrow">
          {homeDoc ? <a href={docHref(homeDoc.path)} dir="auto">{homeDoc.title}</a> : "Book"}
          {info.ga ? ` · GA ${info.ga}` : ""}{info.section ? ` · ${info.section}` : ""}
        </span>
        <h1 className="display" dir="auto">{d.title}</h1>
        {(meta || info.translator) && <p className="muted" dir="auto">{[meta, info.translator ? `Translated by ${info.translator}` : ""].filter(Boolean).join(" · ")}</p>}
        <div className="btn-row">
          {info.source && <a className="btn ghost sm" href={info.source} target="_blank" rel="noopener">rsarchive.org <IconExternal /></a>}
          {info.german && <a className="btn ghost sm" href={info.german} target="_blank" rel="noopener">German original <IconExternal /></a>}
        </div>
      </section>
      <section className="card reader">
        <div className="reader-tip">
          <p className="muted small">Select a passage to keep it with the book's highlights.</p>
          <ReadingButton />
        </div>
        <div ref={box}><Markdown body={readingText(d.body)} from={d.path} className="reader-text" /></div>
        {button}
      </section>
      <nav className="chapter-nav" aria-label="Chapters">
        {prev ? <a className="chapter-nav-card" href={docHref(prev.path)}><span className="eyebrow"><IconBack /> Previous</span><span className="chapter-nav-label" dir="auto">{prev.title}</span></a> : <span />}
        {next ? <a className="chapter-nav-card next" href={docHref(next.path)}><span className="eyebrow">Next <IconNext /></span><span className="chapter-nav-label" dir="auto">{next.title}</span></a> : homeDoc ? <a className="chapter-nav-card next" href={docHref(homeDoc.path)}><span className="eyebrow">The end</span><span className="chapter-nav-label" dir="auto">Back to {homeDoc.title}</span></a> : <span />}
      </nav>
    </>
  );
}

function Highlights({ path, hls, pdf }: { path: string; hls: Highlight[]; pdf?: boolean }) {
  useVault();
  const cards = readCards();
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
      {hls.length > 0 && !adding && edit == null && <p className="muted small">Make any of them a flashcard with <IconCards width={15} height={15} className="inline-icon" />. Words marked <code>==like this==</code> are hidden on the card.</p>}
      <ul className="hl-list">
        {hls.map((h, i) => (
          <li key={`${h.start}-${h.quote.slice(0, 20)}`}>
            {edit === i ? (
              <HighlightForm quote={h.quote} comment={h.comment} onSave={(q, c) => { editHighlight(path, h, q, c); setEdit(null); }} onCancel={() => setEdit(null)}
                onRemove={async () => { if (!(await confirmAsk({ title: "Delete this highlight?", body: h.quote.length > 140 ? h.quote.slice(0, 140) + "…" : h.quote }))) return; editHighlight(path, h, null); setEdit(null); }} />
            ) : (
              <div className="hl-row">
                <button type="button" className="hl" onClick={() => { setEdit(i); setAdding(false); }}>
                  <blockquote dir="auto"><QuoteText q={h.quote} /></blockquote>
                  {h.comment && !(pdf && /^\[\[[^\]]+\.pdf#page=\d+\|p\. \d+\]\]$/i.test(h.comment.trim())) && <p className="muted small" dir="auto">{plainLinks(h.comment)}</p>}
                </button>
                {pdf && pageOf(h.comment) && <button type="button" className="btn ghost sm hl-page" onClick={() => openSheet({ kind: "pdf", path, page: pageOf(h.comment) })} aria-label={`Open the PDF at page ${pageOf(h.comment)}`}>p. {pageOf(h.comment)}</button>}
                <CardToggle path={path} quote={h.quote} cards={cards} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where a PDF is: on this device, in the vault, or only on the device that added it. */
function PdfStatus({ state, fm }: { state: PdfState; fm: Record<string, unknown> }) {
  const size = typeof fm.pdfSize === "number" ? ` · ${mb(fm.pdfSize)}` : "";
  const text = state.kind === "loading" ? ""
    : state.kind === "here" ? (state.rec.local ? `PDF${size} · only on this device: it's bigger than the vault takes` : state.rec.uploaded ? `PDF${size} · on this device and in the vault` : `PDF${size} · on this device: it goes to the vault when the app is connected and online`)
    : state.kind === "vault" ? `PDF${size} · in the vault: downloaded the first time you read it here`
    : fm.pdfLocal ? `PDF${size} · only on the device it was added on (too big for the vault)` : `PDF${size} · not in the vault yet: it goes once the device that added it is online and connected`;
  return text ? <p className="muted small">{text}</p> : null;
}

/** Make a highlight a flashcard, or stop it being one. */
function CardToggle({ path, quote, cards }: { path: string; quote: string; cards: CardMap }) {
  const on = isCard(quote, cards);
  const label = on ? "A flashcard: stop" : "Make it a flashcard";
  return (
    <button type="button" className={`icon-btn subtle${on ? " on" : ""}`} aria-pressed={on} aria-label={label} title={label} onClick={() => setCard(path, quote, !on)}>
      <IconCards />
    </button>
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
        {onRemove && <button type="button" className="btn ghost sm danger" onClick={onRemove}>Delete</button>}
      </div>
    </form>
  );
}

// ── note ──────────────────────────────────────────────────────
export function TitleInput({ d }: { d: Doc }) {
  const [v, setV] = useState(d.title);
  useEffect(() => setV(d.title), [d.title]);
  const commit = () => {
    if (v.trim() && v.trim() !== d.title) { const next = retitle(d.path, v); if (next !== d.path) history.replaceState(history.state, "", docHref(next)); window.dispatchEvent(new HashChangeEvent("hashchange")); }
    else setV(d.title);
  };
  return (
    <input className="title-input display" dir="auto" value={v} aria-label="Title" readOnly={d.sealed} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") { setV(d.title); (e.target as HTMLInputElement).blur(); } }} />
  );
}

function NotePage({ d, ix }: { d: Doc; ix: Index }) {
  const [editing, setEditing] = useEditing(!d.body.trim());
  const folder = d.path.includes("/") ? d.path.slice(0, d.path.lastIndexOf("/")) : "";
  return (
    <>
      <Back fallback="#notes" />
      <section className="card note-card-main">
        <div className="note-head">
          <div className="grow">
            <span className="eyebrow">{folder || "Vault"}{typeof d.fm.created === "string" ? ` · ${medDate(d.fm.created)}` : ""}{d.private && <PrivateBadge />}</span>
            <TitleInput d={d} />
          </div>
          <div className="head-tools">
            {!d.sealed && <PrivateButton path={d.path} on={!!d.private} />}
            <PinButton d={d} />
            <GraphButton path={d.path} />
            {!d.sealed && <OutlineButton path={d.path} body={d.body} editing={editing} />}
            {!d.sealed && <SketchButton note={d.path} />}
            {!d.sealed && <ReadingButton />}
            {!d.sealed && <EditToggle editing={editing} set={setEditing} />}
            <Menu label="More" icon={<IconMore />} items={[
              inboxItem(d),
              { label: "Delete", danger: true, run: async () => { if (await deleteDocs([d.path])) back("#notes"); } },
            ]} />
          </div>
        </div>
        <Topics ix={ix} d={d} />
        <div className="body-wrap">
          {d.sealed ? <LockedBody /> : <NoteBody path={d.path} body={d.body} editing={editing} autoFocus={!d.body.trim()} placeholder="Write… [[ links a note or topic, # adds a tag." />}
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
            <span className="eyebrow">{date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : "Journal"}{d?.private && <PrivateBadge />}</span>
            <h1 className="display">{longDate(date)}</h1>
          </div>
          <div className="head-tools">
            {!d?.sealed && <PrivateButton path={path} on={!!d?.private} />}
            {d && <PinButton d={d} />}
            {d && <GraphButton path={path} />}
            {!d?.sealed && <OutlineButton path={path} body={body} editing={editing} />}
            {!d?.sealed && <SketchButton note={path} />}
            {!d?.sealed && <ReadingButton />}
            {!d?.sealed && <EditToggle editing={editing} set={setEditing} write={!body.trim()} />}
            {d && <Menu label="More" icon={<IconMore />} items={[{ label: "Delete this entry", danger: true, run: () => void deleteDocs([path], `the entry for ${longDate(date)}`) }]} />}
          </div>
        </div>
        {d && <Topics ix={ix} d={d} />}
        <HabitsThatDay ix={ix} date={date} />
        <div className="body-wrap">
          {d?.sealed ? <LockedBody /> : <NoteBody key={path} path={path} body={body} editing={editing} autoFocus={!body.trim()}
            placeholder="How was today? What did you read, think, notice? [[Stoicism]] puts this entry under that topic." />}
        </div>
        {d && <Tags d={d} />}
      </section>
      {d && <LinkedFrom ix={ix} path={path} />}
    </>
  );
}

/** What I logged that day, read-only (logging happens on Home and the habit's page). */
function HabitsThatDay({ ix, date }: { ix: Index; date: string }) {
  const done = [...ix.docs.values()].filter((h) => h.kind === "habit").flatMap((h) => {
    const e = h.log?.find((x) => x.date === date);
    return e ? [{ h, e }] : [];
  }).sort((a, b) => a.h.title.localeCompare(b.h.title));
  if (!done.length) return null;
  return (
    <div className="chips habits-day" aria-label="Habits logged this day">
      {done.map(({ h, e }) => (
        <a key={h.path} className="chip" href={docHref(h.path)}>
          <span aria-hidden="true">{habitIcon(h)}</span> <span dir="auto">{h.title}</span>{e.amount != null && <span className="muted">{amountText(h, e.amount)}</span>}
        </a>
      ))}
    </div>
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
            pinItem(d),
            { label: editing ? "Show steps" : "Edit steps", run: () => setEditing((x) => !x) },
            { label: "Delete", danger: true, run: async () => { if (await deleteDocs([d.path])) back("#topics"); } },
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
          <EditToggle editing={editing} set={setEditing} />
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

export { Topics as DocTopics, Tags as DocTags };
