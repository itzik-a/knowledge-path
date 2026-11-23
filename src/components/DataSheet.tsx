/* "Vault & settings": connect the vault repo, capture from other apps, the enricher's status, suggestions, backup. */
import { confirmAsk } from "../lib/confirm";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ago } from "../lib/dates";
import { showToast } from "../lib/toast";
import { removeSuggestions, suggestionCount } from "../state/actions";
import { clearAll } from "../state/db";
import { allRecords, readFile, useVault, writeFiles } from "../state/store";
import { DEFAULT_REPO, TOKEN_URL, checkRepo, connect, disconnect, getConfig, syncNow, useSyncStatus, type RepoCheck, type SyncStatus } from "../state/sync";
import { IconExternal } from "./Icons";
import { PrivateForm } from "./PrivateNotes";
import { Sheet } from "./ui";

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

export function DataSheet({ onClose }: { onClose: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const iv = setInterval(() => tick((n) => n + 1), 10_000); return () => clearInterval(iv); }, []);
  return (
    <Sheet title="Vault & settings" onClose={onClose}>
      <SyncSection />
      <section className="dlg-section" aria-labelledby="priv-title">
        <h3 id="priv-title">Private notes</h3>
        <PrivateForm />
      </section>
      <EnricherSection />
      <CaptureSection />
      <MoreSection />
    </Sheet>
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
      <a className="btn ghost bookmarklet" href={bookmarklet} onClick={(e) => { e.preventDefault(); showToast("Drag it to the bookmarks bar"); }}>＋ Knowledge Path</a>
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
      if (!j.files || typeof j.files !== "object") throw new Error("That isn't a Knowledge Path backup.");
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
