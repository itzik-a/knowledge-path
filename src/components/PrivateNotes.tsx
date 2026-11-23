/* Private notes: the passphrase form (in Vault & settings, and as its own sheet when a note is made private
   before this device has one), and what a private note shows while this device can't read it. */
import { useState, type FormEvent } from "react";
import { confirmAsk } from "../lib/confirm";
import { useHasPassphrase } from "../lib/passphrase";
import { openSheet } from "../lib/sheets";
import { changePassphrase, enterPassphrase, lockDevice, MIN_PASSPHRASE, sealedHere, setPrivate } from "../state/privacy";
import { useIndex } from "../state/store";
import { IconLock } from "./Icons";
import { Sheet } from "./ui";

/** `then`: a note to make private once the passphrase is set. */
export function PrivateSheet({ then, onClose }: { then?: string; onClose: () => void }) {
  return (
    <Sheet title="Locked notes" onClose={onClose}>
      <PrivateForm then={then} />
    </Sheet>
  );
}

export function PrivateForm({ then }: { then?: string }) {
  const ix = useIndex();
  const has = useHasPassphrase();
  const [changing, setChanging] = useState(false);
  const sealed = sealedHere().length;
  const count = [...ix.docs.values()].filter((d) => d.private).length;
  const notes = (n: number) => (n === 1 ? "1 locked note" : `${n} locked notes`);
  const done = (dlg: HTMLDialogElement | null) => { if (then) { setPrivate(then, true); dlg?.close(); } };

  if (has && !changing) {
    return (
      <>
        <p className="small"><IconLock className="inline-icon" /> {count ? `${notes(count)}, readable on this device.` : "Readable on this device."} In the vault their text is encrypted.</p>
        {sealed > 0 && <p className="small">{notes(sealed)} here {sealed === 1 ? "was" : "were"} encrypted with another passphrase and can't be read.</p>}
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={() => setChanging(true)}>Change passphrase</button>
          <button type="button" className="btn ghost danger" onClick={async () => {
            if (await confirmAsk({ title: "Forget the passphrase on this device?", body: "Locked notes stay encrypted here until you type it again.", ok: "Forget it" })) void lockDevice();
          }}>Forget the passphrase here</button>
        </div>
      </>
    );
  }
  if (!has && sealed) {
    return (
      <>
        <p className="small">{notes(sealed)} came from your vault encrypted. Type your passphrase to read and edit {sealed === 1 ? "it" : "them"} on this device.</p>
        <PassForm confirm={false} ok="Open them" onSubmit={async (pass, dlg) => {
          if (!(await enterPassphrase(pass))) return "That passphrase doesn't open them.";
          done(dlg);
          return null;
        }} />
      </>
    );
  }
  return (
    <>
      {changing ? (
        <p className="small">Every locked note goes to the vault again, encrypted with the new passphrase. Your other devices then need the new one.</p>
      ) : (
        <>
          <p className="small">
            A locked note is encrypted on your device before it goes to the vault, so GitHub, the enricher and anyone who can open the repo
            see its title and topics but not its text. Choose a passphrase, and type the same one on each of your devices.
          </p>
          <p className="small"><b>Nothing can recover a lost passphrase:</b> keep it in your password manager.</p>
          <p className="muted small">
            A note that was already in the vault keeps its earlier, unencrypted versions in the repo's history. In Obsidian, the Meld Encrypt
            plugin opens locked notes with the same passphrase.
          </p>
        </>
      )}
      <PassForm confirm ok={changing ? "Change passphrase" : then ? "Lock the note" : "Save passphrase"} onCancel={changing ? () => setChanging(false) : undefined}
        onSubmit={async (pass, dlg) => {
          if (changing) { changePassphrase(pass); setChanging(false); return null; }
          if (!(await enterPassphrase(pass))) return "That passphrase doesn't open the locked notes here.";
          done(dlg);
          return null;
        }} />
    </>
  );
}

function PassForm({ confirm, ok, onSubmit, onCancel }: {
  confirm: boolean; ok: string; onCancel?: () => void;
  /** An error to show, or null when it worked. */
  onSubmit: (pass: string, dialog: HTMLDialogElement | null) => Promise<string | null>;
}) {
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const short = confirm && pass.length > 0 && pass.length < MIN_PASSPHRASE;
  const differ = confirm && again.length > 0 && again !== pass;
  const ready = confirm ? pass.length >= MIN_PASSPHRASE && again === pass : !!pass;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || busy) return;
    const dialog = e.currentTarget.closest("dialog"); // now: the form may be gone once the passphrase is saved
    setBusy(true); setErr("");
    const msg = await onSubmit(pass, dialog);
    setBusy(false);
    if (msg) setErr(msg); else { setPass(""); setAgain(""); }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <input className="text-input" type="password" autoComplete={confirm ? "new-password" : "current-password"} autoCapitalize="off" spellCheck={false}
        data-autofocus placeholder="Passphrase" aria-label="Passphrase" aria-invalid={short || !!err} value={pass} onChange={(e) => { setPass(e.target.value); setErr(""); }} />
      {confirm && (
        <input className="text-input" type="password" autoComplete="new-password" autoCapitalize="off" spellCheck={false}
          placeholder="The same again" aria-label="Passphrase again" aria-invalid={differ} value={again} onChange={(e) => setAgain(e.target.value)} />
      )}
      {short && <p className="muted small">At least {MIN_PASSPHRASE} characters; a few words is best.</p>}
      {differ && <p className="form-error">The two don't match.</p>}
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className={onCancel ? "dlg-actions row" : "dlg-actions"}>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" type="submit" disabled={!ready || busy}>{busy ? "Working…" : ok}</button>
      </div>
    </form>
  );
}

/** In place of a private note's text while this device can't read it. */
export function LockedBody() {
  return (
    <div className="locked-body">
      <IconLock />
      <p className="small">This note is locked. Its text is encrypted, and this device doesn't have the passphrase yet.</p>
      <button type="button" className="btn sm" onClick={() => openSheet({ kind: "private" })}>Enter passphrase</button>
    </div>
  );
}

export function PrivateBadge() {
  return <span className="private-badge" title="Encrypted in the vault"><IconLock /> Locked</span>;
}
