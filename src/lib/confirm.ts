/* "Are you sure?" as the app's own modal: `if (!(await confirmAsk({ title: "Delete SPQR?" }))) return;` */
import { useSyncExternalStore } from "react";

export interface ConfirmReq { title: string; body?: string; ok?: string; danger?: boolean }
interface Open extends ConfirmReq { id: number; resolve: (yes: boolean) => void }

let cur: Open | null = null;
let n = 0;
const ls = new Set<() => void>();
const emit = () => ls.forEach((l) => l());

export function confirmAsk(r: ConfirmReq): Promise<boolean> {
  cur?.resolve(false);
  return new Promise((resolve) => { cur = { ...r, id: ++n, resolve }; emit(); });
}

export function answerConfirm(yes: boolean) {
  const c = cur;
  cur = null;
  emit();
  c?.resolve(yes);
}

export const useConfirm = () => useSyncExternalStore((l) => { ls.add(l); return () => { ls.delete(l); }; }, () => cur);
