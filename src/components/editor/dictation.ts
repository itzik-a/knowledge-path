/* Dictation into the editor with the browser's speech recognition (Safari on iPhone, iPad and the Mac; Chrome):
   the mic button on the keyboard bar, or /dictate. Words go in at the cursor as they're recognised (final results
   only, so nothing jumps); Hebrew when the line has Hebrew, else the device's language. One session at a time;
   tap again (or Done) to stop. Without speech recognition the button isn't shown. */
import type { EditorView } from "@codemirror/view";
import { useSyncExternalStore } from "react";
import { showToast } from "../../lib/toast";

interface Rec { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
type RecCtor = new () => Rec;
const Ctor = (): RecCtor | undefined => (globalThis as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }).SpeechRecognition
  ?? (globalThis as unknown as { webkitSpeechRecognition?: RecCtor }).webkitSpeechRecognition;

export const canDictate = () => !!Ctor();

let rec: Rec | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const useDictating = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => !!rec);

export function stopDictation() { rec?.stop(); }

export function toggleDictation(view: EditorView) {
  if (rec) { rec.stop(); return; }
  const C = Ctor();
  if (!C) { showToast("Dictation isn't available here: use the keyboard's mic"); return; }
  const r = new C();
  const line = view.state.doc.lineAt(view.state.selection.main.head).text;
  r.lang = /[֐-׿]/.test(line) ? "he-IL" : navigator.language || "en-GB";
  r.continuous = true;
  r.interimResults = false;
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      const said = e.results[i][0].transcript.trim();
      if (!said) continue;
      const at = view.state.selection.main;
      const prev = view.state.sliceDoc(at.from - 1, at.from);
      const insert = (prev && !/\s/.test(prev) ? " " : "") + said;
      view.dispatch({ changes: { from: at.from, to: at.to, insert }, selection: { anchor: at.from + insert.length }, scrollIntoView: true, userEvent: "input.dictation" });
    }
  };
  r.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") showToast(e.error === "not-allowed" ? "Allow the microphone to dictate" : `Dictation stopped: ${e.error}`); };
  r.onend = () => { if (rec === r) { rec = null; emit(); } };
  rec = r;
  emit();
  try { r.start(); } catch { rec = null; emit(); }
}
