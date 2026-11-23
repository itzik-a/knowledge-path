/* Sketch files in vault terms: find the one an embed names, save a drawing (new or changed) and put its
   embed in the note, delete one (and its embed), and the sketches that go with a deleted note. */
import { appendEmbed, isSketchPath, removeEmbed, serializeSketch, SKETCH_FOLDER, sketchEmbeds, sketchName, type Sketch } from "../../shared/sketch.ts";
import { setBody, splitFrontmatter } from "../../shared/vault.ts";
import { insertInEditor } from "../lib/insert";
import { showToast } from "../lib/toast";
import { allRecords, readFile, removeFiles, taken, writeFile } from "./store";

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The file an embed like ![[Sketch ….svg]] points at: by name (Sketches/ first), or by its path. */
export function findSketch(target: string): string | undefined {
  const t = target.trim().toLowerCase();
  if (!isSketchPath(t)) return undefined;
  const live = allRecords().filter((r) => !r.deleted && isSketchPath(r.path));
  const exact = live.find((r) => r.path.toLowerCase() === t);
  if (exact) return exact.path;
  const named = live.filter((r) => nameOf(r.path).toLowerCase() === nameOf(t));
  return (named.find((r) => r.path.startsWith(SKETCH_FOLDER + "/")) ?? named[0])?.path;
}

function newSketchPath(): string {
  const name = sketchName();
  let p = `${SKETCH_FOLDER}/${name}`;
  for (let i = 2; taken(p); i++) p = `${SKETCH_FOLDER}/${name.replace(/\.svg$/, ` ${i}.svg`)}`;
  return p;
}

/** Save a drawing. A new one gets a file and an embed in the note: at the cursor if the note is open in
    the editor, else at the end (creating the note, e.g. today's journal entry, if it doesn't exist yet). */
export function saveSketch(s: Sketch, opts: { path?: string; note?: string }): string {
  const svg = serializeSketch(s);
  if (opts.path) { writeFile(opts.path, svg); return opts.path; }
  const path = newSketchPath();
  const embed = `![[${nameOf(path)}]]`;
  const note = opts.note;
  writeFile(path, svg); // first, so the embed finds it
  // in the open editor, it saves the note as it would any typing
  if (note && !insertInEditor(note, embed)) {
    const c = readFile(note);
    writeFile(note, c == null ? appendEmbed("", nameOf(path)) : setBody(c, appendEmbed(splitFrontmatter(c).body, nameOf(path))));
  }
  return path;
}

/** Remove a sketch and its embed from the note it's in, with one Undo for both. */
export function deleteSketch(path: string, note?: string) {
  const before = note ? readFile(note) : undefined;
  const undoFile = removeFiles([path]);
  if (note && before != null) {
    const { body } = splitFrontmatter(before);
    const next = removeEmbed(body, nameOf(path));
    if (next !== body) writeFile(note, setBody(before, next));
  }
  showToast("Deleted the sketch", {
    label: "Undo",
    run: () => { undoFile(); if (note && before != null) writeFile(note, before); },
  });
}

/** Sketches embedded in these notes and in no other file: they go when the notes are deleted. */
export function sketchesOnlyIn(paths: string[]): string[] {
  const gone = new Set(paths);
  const mine = new Set<string>();
  const elsewhere = new Set<string>();
  for (const r of allRecords()) {
    if (r.deleted || !r.path.endsWith(".md")) continue;
    for (const name of sketchEmbeds(r.content)) {
      const p = findSketch(name);
      if (p) (gone.has(r.path) ? mine : elsewhere).add(p);
    }
  }
  return [...mine].filter((p) => !elsewhere.has(p));
}
