/* This device's passphrase for private notes (shared/private.ts), kept like the vault token: in localStorage. */
import { useSyncExternalStore } from "react";

const LS = "knowledgePath.passphrase";
const ls = new Set<() => void>();

export function getPassphrase(): string {
  try { return localStorage.getItem(LS) ?? ""; } catch { return ""; }
}
export function savePassphrase(pass: string | null) {
  if (pass) localStorage.setItem(LS, pass); else localStorage.removeItem(LS);
  ls.forEach((l) => l());
}
export function useHasPassphrase() {
  return useSyncExternalStore((l) => { ls.add(l); return () => { ls.delete(l); }; }, () => !!getPassphrase());
}
