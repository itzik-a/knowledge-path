/* Parts of the app loaded on first use (cook mode, the session timer, PDFs, sketches, the editor). A deploy replaces
   their files on GitHub Pages, so an app left open since an older version asks for a file that's gone: the import
   fails ("Failed to fetch dynamically imported module", Safari: "Importing a module script failed"). Instead of
   letting that blank the page, save what's pending, remember the sheet that was being opened, and reload once
   onto the new version, which opens it again (`reopenSheet`, from App once the vault is ready). */
import { lazy, type ComponentType } from "react";
import { closeSheetReq, currentSheet, openSheet, type SheetReq } from "./sheets";

const RELOADED = "knowledgePath.reloadedForUpdate";
const REOPEN = "knowledgePath.reopenSheet";
/** Don't reload again within this long (a file that's really broken must not loop). */
const GAP_MS = 60_000;

export function canReloadForUpdate(now = Date.now(), last = Number(sessionStorage.getItem(RELOADED) || 0)) {
  return !last || now - last > GAP_MS;
}

async function reloadForUpdate(): Promise<never> {
  sessionStorage.setItem(RELOADED, String(Date.now()));
  const s = currentSheet();
  if (s) sessionStorage.setItem(REOPEN, JSON.stringify(s));
  try { const { flush } = await import("../state/store"); await flush(); } catch { /* reload anyway */ }
  location.reload();
  return new Promise<never>(() => { /* stays loading until the page goes */ });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPart<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() => load().catch((e: unknown) => {
    if (canReloadForUpdate()) return reloadForUpdate();
    throw e;
  }));
}

/** After a reload for an update: open the sheet that was being opened (once). */
export function reopenSheet() {
  const raw = sessionStorage.getItem(REOPEN);
  if (!raw) return;
  sessionStorage.removeItem(REOPEN);
  try { openSheet(JSON.parse(raw) as SheetReq); } catch { closeSheetReq(); }
}
