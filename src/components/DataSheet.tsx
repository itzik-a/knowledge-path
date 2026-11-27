/* "Vault & settings": connect the vault repo, capture from other apps, the enricher's status, suggestions, backup. */
import { confirmAsk } from "../lib/confirm";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { ago } from "../lib/dates";
import { openSheet } from "../lib/sheets";
import { showToast } from "../lib/toast";
import { removeSuggestions, suggestionCount } from "../state/actions";
import { clearAll } from "../state/db";
import { allRecords, readFile, useIndex, useVault, writeFiles } from "../state/store";
import { DEFAULT_REPO, TOKEN_URL, checkRepo, connect, disconnect, getConfig, syncNow, useSyncStatus, type RepoCheck, type SyncStatus } from "../state/sync";
import { IconExternal, IconGrip } from "./Icons";
import { AccentPicker, ThemePicker } from "./ThemePicker";
import { homeCards, resetHome, setHomeOrder, setHomeCardShown, setSinkChecked, useHomeLayout, useSinkChecked } from "../state/settings";
import { PrivateForm } from "./PrivateNotes";
import { Sheet, Switch } from "./ui";

const dotClass = (s: SyncStatus) => (s.kind === "ok" ? "ok" : s.kind === "busy" ? "busy" : s.kind === "pending" ? "pending" : s.kind === "error" ? "err" : "");

export function DataPill({ onOpen }: { onOpen: () => void }) {
  const s = useSyncStatus();
  return (
    <button type="button" className="sync" onClick={onOpen} aria-label={`Sync: ${s.text}. Open vault and settings`}>
      <span className={`dot ${dotClass(s)}`} />
      <span role="status">{s.text}</span>
    </button>
  );
}

export function DataSheet({ onClose, section }: { onClose: () => void; section?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const iv = setInterval(() => tick((n) => n + 1), 10_000); return () => clearInterval(iv); }, []);
  useEffect(() => {
    if (!section) return;
    const t = setTimeout(() => document.getElementById(`${section}-title`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
    return () => clearTimeout(t);
  }, [section]);
  return (
    <Sheet title="Vault & settings" onClose={onClose}>
      <SyncSection />
      <section className="dlg-section" aria-labelledby="priv-title">
        <h3 id="priv-title">Locked notes</h3>
        <PrivateForm />
      </section>
      <EnricherSection />
      <CaptureSection />
      <section className="dlg-section" aria-labelledby="theme-title">
        <h3 id="theme-title">Appearance</h3>
        <ThemePicker />
        <p className="muted small">System follows this device's light or dark setting; Sepia is warm paper, easy on the eyes at night. Each device keeps its own choice.</p>
        <AccentPicker />
        <p className="muted small">The accent colour is the same on every device (it syncs with the vault).</p>
        <p className="muted small">The font, text size, line spacing and page width are in the <b>Aa</b> button, beside search.</p>
      </section>
      <NotesSection />
      <HomeSection />
      <MoreSection />
    </Sheet>
  );
}

/* Settings for every device (synced in .hub/settings.json, src/state/settings.ts). */
function NotesSection() {
  const sink = useSinkChecked();
  return (
    <section className="dlg-section" aria-labelledby="notes-title">
      <h3 id="notes-title">Checklists</h3>
      <label className="switch-row"><Switch on={sink} onChange={setSinkChecked} label="Move ticked items to the bottom" /> Move ticked items to the bottom</label>
      <p className="muted small">Like Apple Notes: a ticked item moves down to the top of the ticked ones, and an unticked one goes back to the end of the items still to do. In notes, journal entries and topic pages; study paths keep their order. The same on every device.</p>
    </section>
  );
}

/** Home's cards: a switch each, dragged by the handle into order (pointer events, so it works with a finger, the Pencil
   and the mouse; ↑ ↓ on a focused handle move it too). The list reorders as the card passes its neighbours' middles. */
function HomeSection() {
  const ix = useIndex();
  const cards = useMemo(() => homeCards(ix), [ix]);
  const { order, hidden } = useHomeLayout(cards);
  const name = (id: string) => cards.find((c) => c.id === id)?.name ?? id;
  const changed = order.join() !== cards.map((c) => c.id).join() || hidden.length > 0;
  const [drag, setDrag] = useState<{ id: string; list: string[]; startY: number; dy: number } | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const list = drag?.list ?? order;

  function onDown(e: PointerEvent<HTMLButtonElement>, id: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, list: order, startY: e.clientY, dy: 0 });
  }
  function onMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    let { list: l, startY } = drag;
    const i = l.indexOf(drag.id);
    const me = rows.current.get(drag.id)?.getBoundingClientRect();
    const midOf = (id: string | undefined) => { const r = id ? rows.current.get(id)?.getBoundingClientRect() : undefined; return r && { mid: r.top + r.height / 2, h: r.height }; };
    if (me) {
      // the card's middle where the pointer has it now (its rect includes the old offset)
      const mid = me.top - drag.dy + me.height / 2 + (e.clientY - startY);
      const next = midOf(l[i + 1]), prev = midOf(l[i - 1]);
      const to = next && mid > next.mid ? { j: i + 1, by: next.h } : prev && mid < prev.mid ? { j: i - 1, by: -prev.h } : null;
      if (to) {
        l = [...l]; [l[i], l[to.j]] = [l[to.j], l[i]];
        startY += to.by; // its slot moved by the neighbour's height
      }
    }
    setDrag({ ...drag, list: l, startY, dy: e.clientY - startY });
  }
  function onUp() {
    if (drag && drag.list.join() !== order.join()) setHomeOrder(drag.list, cards);
    setDrag(null);
  }
  function onKey(e: KeyboardEvent<HTMLButtonElement>, id: string) {
    const by = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    const i = order.indexOf(id), j = i + by;
    if (!by || j < 0 || j >= order.length) return;
    e.preventDefault();
    const l = [...order]; [l[i], l[j]] = [l[j], l[i]];
    setHomeOrder(l, cards);
  }

  return (
    <section className="dlg-section" aria-labelledby="home-title">
      <h3 id="home-title">Home</h3>
      <p className="muted small">Which cards Home shows; drag them by the handle into order. A habit gets its own card from its Edit sheet. A card with nothing in it stays away anyway. The same on every device.</p>
      <ul className={`home-cards${drag ? " dragging" : ""}`}>
        {list.map((id) => {
          const shown = !hidden.includes(id);
          const me = drag?.id === id;
          return (
            <li key={id} ref={(el) => { if (el) rows.current.set(id, el); else rows.current.delete(id); }}
              className={[shown ? "" : "off", me ? "lifted" : ""].join(" ").trim() || undefined}
              style={me ? { transform: `translateY(${drag.dy}px)` } : undefined}>
              <Switch on={shown} onChange={(on) => setHomeCardShown(id, on, cards)} label={`Show ${name(id)}`} />
              <span className="grow">{name(id)}</span>
              <button type="button" className="icon-btn grip" aria-label={`Reorder ${name(id)} (drag, or use the arrow keys)`}
                onPointerDown={(e) => onDown(e, id)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                onKeyDown={(e) => onKey(e, id)}><IconGrip /></button>
            </li>
          );
        })}
      </ul>
      {changed && <button type="button" className="text-btn" onClick={() => resetHome(cards)}>Back to the default</button>}
    </section>
  );
}

function SyncSection() {
  const s = useSyncStatus();
  return (
    <section className="dlg-section" aria-labelledby="sync-title">
      <h3 id="sync-title">Your vault</h3>
      {s.kind === "off" ? <Connect /> : <Connected />}
    </section>
  );
}

function Connect() {
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [publicRepo, setPublicRepo] = useState<RepoCheck | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await checkRepo(token, repo);
      if (!r.isPrivate) { setPublicRepo(r); return; }
      await connect(r.cfg);
      setToken("");
    } catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <p className="muted small">
        Everything is saved on this device. Connect each of your devices to your vault, a private GitHub repo of Markdown files, to
        have everything everywhere. The same files open in Obsidian.
      </p>
      <ol className="steps">
        <li>
          <b>Create a token for the vault</b>
          <span className="muted small">
            On the form: <i>Repository access</i> → <i>Only select repositories</i> → <code>knowledge-vault</code>. Under <i>Permissions</i>,
            set <i>Contents</i> to <i>Read and write</i>. Choose an expiration, press <i>Generate token</i>, and copy it.
          </span>
          <a className="link" href={TOKEN_URL} target="_blank" rel="noopener">Open GitHub token page <IconExternal /></a>
        </li>
        <li>
          <b>Paste it here</b>
          <form className="form-grid" onSubmit={submit}>
            <input className="text-input" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="github_pat_…" aria-label="GitHub token"
              value={token} onChange={(e) => { setToken(e.target.value); setPublicRepo(null); }} />
            <input className="text-input" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="Vault repo (owner/name)" value={repo}
              onChange={(e) => { setRepo(e.target.value); setPublicRepo(null); }} />
            {publicRepo ? (
              <div className="sub-form form-grid">
                <p className="small"><b>{publicRepo.cfg.owner}/{publicRepo.cfg.repo} is public:</b> anyone could read your notes and journal. Make it private on GitHub first (Settings → Danger zone → Change visibility).</p>
                <button type="button" className="btn ghost danger" onClick={() => { void connect(publicRepo.cfg); setPublicRepo(null); }}>Connect anyway</button>
              </div>
            ) : (
              <button className="btn primary" type="submit" disabled={busy || !token.trim()}>{busy ? "Checking…" : "Connect"}</button>
            )}
          </form>
          {err && <p className="form-error" role="alert">{err}</p>}
        </li>
      </ol>
      <p className="muted small">The token stays on this device and can only read and write that one repo.</p>
    </>
  );
}

function Connected() {
  const s = useSyncStatus();
  const cfg = getConfig();
  return (
    <>
      <div className="sync-state">
        <span className={`dot ${dotClass(s)}`} />
        <div>
          <b>{s.text}</b>
          <span className="muted small">Last synced {s.last ? ago(s.last) : "not yet"} · <a href={`https://github.com/${cfg?.owner}/${cfg?.repo}`} target="_blank" rel="noopener">{cfg?.owner}/{cfg?.repo}</a></span>
        </div>
      </div>
      {s.detail && s.kind !== "ok" && s.kind !== "busy" && <p className="small">{s.detail}</p>}
      <div className="dlg-actions">
        <button type="button" className="btn primary" disabled={s.kind === "busy"} onClick={() => void syncNow(true)}>Sync now</button>
        <button type="button" className="btn ghost danger" onClick={async () => { if (await confirmAsk({ title: "Disconnect this device?", body: "It stops syncing. Everything stays here and in the vault.", ok: "Disconnect" })) void disconnect(); }}>
          Disconnect this device
        </button>
      </div>
    </>
  );
}

interface EnrichStatus { at?: string; enriched?: number; failed?: number; explored?: number; claude?: boolean; costUsd?: number; monthUsd?: number; error?: string }

function EnricherSection() {
  useVault();
  const raw = readFile(".hub/status.json");
  let st: EnrichStatus | null = null;
  try { st = raw ? (JSON.parse(raw) as EnrichStatus) : null; } catch { st = null; }
  const cfg = getConfig();
  return (
    <section className="dlg-section" aria-labelledby="en-title">
      <h3 id="en-title">Filling in saved links</h3>
      <p className="muted small">
        After a sync, a GitHub Action in the vault fetches each new link's title, author, image and readable text, and asks Claude
        (Haiku) for a two-line summary and the topics it fits. It also answers Explore.
      </p>
      {st ? (
        <p className="small">
          Last run {st.at ? ago(Date.parse(st.at)) : "—"}{st.enriched ? ` · filled in ${st.enriched}` : ""}{st.failed ? ` · ${st.failed} couldn't be read` : ""}
          {st.monthUsd != null ? ` · this month $${st.monthUsd.toFixed(2)}` : ""}
          {st.claude === false && <><br /><b>Claude isn't set up yet:</b> add an <code>ANTHROPIC_API_KEY</code> secret to the vault repo (Settings → Secrets and variables → Actions). Until then it only fetches titles and text.</>}
          {st.error && <><br /><span className="form-error">{st.error}</span></>}
        </p>
      ) : (
        <p className="muted small">It hasn't run yet{cfg ? "" : " (connect the vault first)"}.</p>
      )}
      {cfg && <a className="link" href={`https://github.com/${cfg.owner}/${cfg.repo}/actions`} target="_blank" rel="noopener">See its runs on GitHub <IconExternal /></a>}
    </section>
  );
}

function CaptureSection() {
  const app = `${location.origin}${location.pathname}`;
  const bookmarklet = `javascript:(()=>{const s=String(getSelection());window.open('${app}#capture?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+(s?'&text='+encodeURIComponent(s):''),'kp','width=480,height=760')})()`;
  const cfg = getConfig();
  const [show, setShow] = useState(false);
  return (
    <section className="dlg-section" aria-labelledby="cap-title">
      <h3 id="cap-title">Save from other apps</h3>
      <p className="small"><b>Mac:</b> drag this to the bookmarks bar, then click it on any page (select text first to save a quote with it):</p>
      {/* eslint-disable-next-line no-script-url */}
      <a className="btn ghost bookmarklet" href={bookmarklet} onClick={(e) => { e.preventDefault(); showToast("Drag it to the bookmarks bar"); }}>＋ Knowledge Hub</a>
      <p className="small"><b>iPhone:</b> a Shortcut in the Share sheet that saves the link straight into the vault.</p>
      <button type="button" className="text-btn" onClick={() => setShow((x) => !x)}>{show ? "Hide the steps" : "Show how to make it"}</button>
      {show && (
        <ol className="steps small">
          <li>In <b>Shortcuts</b>, make a new shortcut. Tap ⓘ → <i>Show in Share Sheet</i>; set it to receive <i>URLs</i> and <i>Safari web pages</i>.</li>
          <li>Add <b>Text</b> with exactly:<pre className="code">{`---\nurl: "Shortcut Input"\nstatus: saved\nadded: "Current Date"\nenrich: pending\nprovisional: true\n---\n`}</pre>
            Replace <i>Shortcut Input</i> and <i>Current Date</i> with the variables (date format <code>yyyy-MM-dd</code>), keeping the quotes.</li>
          <li>Add <b>Base64 Encode</b> (of the Text).</li>
          <li>Add <b>Get Contents of URL</b>: <code>https://api.github.com/repos/{cfg ? `${cfg.owner}/${cfg.repo}` : DEFAULT_REPO}/contents/Resources/Saved-[Current Date].md</code> (date format <code>yyyyMMdd-HHmmss</code>, so the name has no spaces). Method <i>PUT</i>; header <code>Authorization</code> = <code>Bearer</code> + your vault token; JSON body: <code>message</code> = <i>Save a link</i>, <code>content</code> = <i>Base64 Encoded</i>.</li>
          <li>Add <b>Show Notification</b>: <i>Saved</i>. Shared links land in the Inbox; the title and the rest arrive within a minute or two.</li>
        </ol>
      )}
      <p className="muted small">In the app, the + button (or <kbd>N</kbd> on the Mac) adds a link or a note, and <kbd>⌘</kbd><kbd>K</kbd> searches.</p>
    </section>
  );
}

function MoreSection() {
  useVault();
  const n = suggestionCount();
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");

  function exportAll() {
    const files = Object.fromEntries(allRecords().filter((r) => !r.deleted).map((r) => [r.path, r.content]));
    const blob = new Blob([JSON.stringify({ app: "knowledge-path", exportedAt: new Date().toISOString(), files }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `knowledge-path-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setNote("Backup downloaded.");
  }
  async function importFile(f?: File) {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text()) as { files?: Record<string, string> };
      if (!j.files || typeof j.files !== "object") throw new Error("That isn't a Knowledge Hub backup.");
      const add = Object.entries(j.files).filter(([p, c]) => typeof c === "string" && readFile(p) == null).map(([path, content]) => ({ path, content }));
      const differ = Object.entries(j.files).filter(([p, c]) => readFile(p) != null && readFile(p) !== c).length;
      if (!(await confirmAsk({ title: `Add ${add.length} files from the backup?`, body: differ ? `${differ} files that are here with other text are left as they are.` : undefined, ok: "Add", danger: false }))) return;
      writeFiles(add);
      setNote(`Added ${add.length} files.`);
    } catch (x) { setNote((x as Error).message); }
    finally { if (file.current) file.current.value = ""; }
  }

  return (
    <section className="dlg-section" aria-labelledby="more-title">
      <h3 id="more-title">More</h3>
      <button type="button" className="text-btn" onClick={() => openSheet({ kind: "shortcuts" })}>Keyboard shortcuts and slash commands</button>
      {n > 0 && (
        <div className="row-between">
          <span className="small">{n} starter suggestions you haven't touched</span>
          <button type="button" className="btn ghost sm" onClick={() => void removeSuggestions()}>Delete them</button>
        </div>
      )}
      <p className="muted small">A backup is one JSON file with every note, for Files or iCloud Drive. The vault on GitHub already keeps every version.</p>
      <div className="dlg-actions row">
        <button type="button" className="btn" onClick={exportAll}>Export backup</button>
        <button type="button" className="btn ghost" onClick={() => file.current?.click()}>Import backup</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
      </div>
      {note && <p className="small" role="status">{note}</p>}
      <button type="button" className="text-btn danger-text" onClick={async () => {
        const dirty = allRecords().filter((r) => r.dirty).length;
        if (!(await confirmAsk({ title: "Clear this device and start over?", body: dirty ? `${dirty} changes haven't reached the vault yet and would be lost.` : "The vault on GitHub isn't touched.", ok: "Clear" }))) return;
        await clearAll();
        await disconnect();
        location.reload();
      }}>Clear this device</button>
    </section>
  );
}
