/* Private notes on this device: the passphrase, unlocking what came from the vault encrypted, making a note
   private, changing the passphrase, and locking this device again. The format and the crypto are
   shared/private.ts; the sync encrypts and decrypts on the way (src/state/sync.ts). */
import { forgetKeys, isLockedName, isPrivate, isSealed, isSealedFile, lockedNameFor, newLockedName, openAny, sealFile, sealSketch, withTitle } from "../../shared/private.ts";
import { basename, dirname, kindOf, setFrontmatter, splitFrontmatter, uniquePath } from "../../shared/vault.ts";
import { docHref } from "../lib/route";
import { retitle } from "./actions";
import { getPassphrase, savePassphrase } from "../lib/passphrase";
import { showToast } from "../lib/toast";
import { allRecords, markDirty, readFile, renameFile, replaceTexts, taken, writeFile } from "./store";
import { lockedSketches, sketchesOf } from "./sketches";
import { syncNow, whenIdle } from "./sync";

export const MIN_PASSPHRASE = 8;

const md = () => allRecords().filter((r) => !r.deleted && r.path.endsWith(".md") && !r.path.startsWith(".hub/"));
/** Private notes here that are still encrypted (they came from the vault before this device had the passphrase). */
export const sealedHere = () => md().filter((r) => isSealed(r.content));
/** Those notes and their sketches. */
const sealedFiles = () => allRecords().filter((r) => !r.deleted && isSealedFile(r.path, r.content));

/** Decrypt what's still encrypted here with `pass`; how many it opened. */
async function reveal(pass: string): Promise<number> {
  const opened: { path: string; was: string; content: string; base?: string }[] = [];
  for (const r of sealedFiles()) {
    const content = await openAny(r.path, r.content, pass);
    if (content == null) continue;
    const base = r.base == null ? undefined : r.base === r.content ? content : (await openAny(r.path, r.base, pass)) ?? r.base;
    opened.push({ path: r.path, was: r.content, content, base });
  }
  await whenIdle();
  // only files that didn't change meanwhile (a sync may have brought newer ones; it decrypts those itself)
  replaceTexts(opened.filter((o) => allRecords().find((r) => r.path === o.path)?.content === o.was));
  return opened.length;
}

/** Use a passphrase on this device. With private notes here still encrypted, it must open them. */
export async function enterPassphrase(pass: string): Promise<boolean> {
  const sealed = sealedFiles().length;
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
  markDirty([...md().filter((r) => isPrivate(r.content) && !isSealed(r.content)).map((r) => r.path), ...lockedSketches()]);
  void syncNow();
  showToast("Passphrase changed: type the new one on your other devices");
}

/** Forget the passphrase here: private notes on this device are encrypted again until it's typed in. */
export async function lockDevice() {
  const pass = getPassphrase();
  if (!pass) return;
  await whenIdle();
  const out: { path: string; content: string; base?: string }[] = [];
  for (const p of lockedSketches()) { // before the notes: it reads their embeds
    const r = allRecords().find((x) => x.path === p)!;
    const content = await sealSketch(r.content, pass);
    out.push({ path: p, content, base: r.base == null ? undefined : r.base === r.content ? content : await sealSketch(r.base, pass) });
  }
  for (const r of md()) {
    if (!isPrivate(r.content) || isSealed(r.content)) continue;
    const content = await sealFile(r.content, pass);
    out.push({ path: r.path, content, base: r.base == null ? undefined : r.base === r.content ? content : await sealFile(r.base, pass) });
  }
  replaceTexts(out);
  savePassphrase(null);
  forgetKeys();
}

/** Lock a note (or unlock it). A note's file gets a neutral name while it's locked, its title kept in its
    frontmatter (encrypted in the vault); unlocking names it after its title again. A journal entry keeps its
    dated name; one that doesn't exist yet (today's) is created locked, empty. Its sketches go out again.
    Returns the note's path now (and moves the page there if it's open). */
export async function setPrivate(path: string, on: boolean, opts: { quiet?: boolean } = {}): Promise<string> {
  const text = readFile(path);
  if (text == null && !on) return path;
  const sketches = sketchesOf(text ?? "");
  let next = path;
  if (kindOf(path) !== "note") {
    writeFile(path, setFrontmatter(text ?? "", { private: on ? true : undefined }));
  } else if (on) {
    const fmTitle = splitFrontmatter(text!).fm.title;
    const name = basename(path);
    const title = typeof fmTitle === "string" && fmTitle.trim() ? fmTitle.trim() : name !== "Untitled" && !isLockedName(name) ? name : undefined;
    writeFile(path, withTitle(setFrontmatter(text!, { private: true, title: undefined }), title));
    if (!isLockedName(name)) {
      const folder = dirname(path);
      const pass = getPassphrase();
      next = `${folder ? folder + "/" : ""}${pass ? await lockedNameFor(path, pass) : newLockedName()}.md`;
      if (taken(next)) next = uniquePath(folder, newLockedName(), taken);
      renameFile(path, next);
    }
  } else {
    const fmTitle = splitFrontmatter(text!).fm.title;
    const title = typeof fmTitle === "string" && fmTitle.trim() ? fmTitle.trim() : "Untitled";
    writeFile(path, setFrontmatter(withTitle(text!, undefined), { private: undefined }));
    next = retitle(path, title);
  }
  markDirty(sketches); // encrypted now, or not (unless another locked note has them)
  if (next !== path && location.hash === docHref(path)) {
    history.replaceState(history.state, "", docHref(next));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  if (!opts.quiet) showToast(on ? "Locked: encrypted in the vault, title included" : "Unlocked: stored as plain text in the vault");
  return next;
}

/** Once per device, for what was locked before these existed: sketches in locked notes go out again
    (encrypted), and locked notes named after their title get a neutral name (the same one on every device). */
export async function migrateLocked() {
  if (!getPassphrase()) return;
  if (!localStorage.getItem("knowledgePath.lockedSketches")) {
    markDirty([...lockedSketches()]);
    localStorage.setItem("knowledgePath.lockedSketches", "1");
  }
  if (!localStorage.getItem("knowledgePath.lockedTitles")) {
    for (const r of md()) {
      if (kindOf(r.path) === "note" && isPrivate(r.content) && !isSealed(r.content) && !isLockedName(basename(r.path))) await setPrivate(r.path, true, { quiet: true });
    }
    localStorage.setItem("knowledgePath.lockedTitles", "1");
  }
}
