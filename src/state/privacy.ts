/* Private notes on this device: the passphrase, unlocking what came from the vault encrypted, making a note
   private, changing the passphrase, and locking this device again. The format and the crypto are
   shared/private.ts; the sync encrypts and decrypts on the way (src/state/sync.ts). */
import { forgetKeys, isPrivate, isSealed, openFile, sealFile } from "../../shared/private.ts";
import { setFrontmatter } from "../../shared/vault.ts";
import { getPassphrase, savePassphrase } from "../lib/passphrase";
import { showToast } from "../lib/toast";
import { allRecords, markDirty, readFile, replaceTexts, writeFile } from "./store";
import { syncNow, whenIdle } from "./sync";

export const MIN_PASSPHRASE = 8;

const md = () => allRecords().filter((r) => !r.deleted && r.path.endsWith(".md") && !r.path.startsWith(".hub/"));
/** Private notes here that are still encrypted (they came from the vault before this device had the passphrase). */
export const sealedHere = () => md().filter((r) => isSealed(r.content));

/** Decrypt what's still encrypted here with `pass`; how many it opened. */
async function reveal(pass: string): Promise<number> {
  const opened: { path: string; was: string; content: string; base?: string }[] = [];
  for (const r of sealedHere()) {
    const content = await openFile(r.content, pass);
    if (content == null) continue;
    const base = r.base == null ? undefined : r.base === r.content ? content : (await openFile(r.base, pass)) ?? r.base;
    opened.push({ path: r.path, was: r.content, content, base });
  }
  await whenIdle();
  // only files that didn't change meanwhile (a sync may have brought newer ones; it decrypts those itself)
  replaceTexts(opened.filter((o) => allRecords().find((r) => r.path === o.path)?.content === o.was));
  return opened.length;
}

/** Use a passphrase on this device. With private notes here still encrypted, it must open them. */
export async function enterPassphrase(pass: string): Promise<boolean> {
  const sealed = sealedHere().length;
  forgetKeys();
  if (sealed && !(await reveal(pass))) return false;
  savePassphrase(pass);
  void syncNow(true); // private notes waiting for it go out; anything encrypted in the vault comes in readable
  return true;
}

/** A new passphrase: every private note goes to the vault again, encrypted with it. */
export function changePassphrase(pass: string) {
  savePassphrase(pass);
  forgetKeys();
  markDirty(md().filter((r) => isPrivate(r.content) && !isSealed(r.content)).map((r) => r.path));
  void syncNow();
  showToast("Passphrase changed: type the new one on your other devices");
}

/** Forget the passphrase here: private notes on this device are encrypted again until it's typed in. */
export async function lockDevice() {
  const pass = getPassphrase();
  if (!pass) return;
  await whenIdle();
  const out: { path: string; content: string; base?: string }[] = [];
  for (const r of md()) {
    if (!isPrivate(r.content) || isSealed(r.content)) continue;
    const content = await sealFile(r.content, pass);
    out.push({ path: r.path, content, base: r.base == null ? undefined : r.base === r.content ? content : await sealFile(r.base, pass) });
  }
  replaceTexts(out);
  savePassphrase(null);
  forgetKeys();
}

/** Mark a note private (or not). A file that doesn't exist yet (today's journal entry) is created private, empty. */
export function setPrivate(path: string, on: boolean) {
  const text = readFile(path);
  if (text == null && !on) return;
  writeFile(path, setFrontmatter(text ?? "", { private: on ? true : undefined }));
  showToast(on ? "Private: encrypted in the vault" : "No longer private: stored as plain text in the vault");
}
