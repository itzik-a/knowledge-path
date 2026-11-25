/* Which templates there are: the vault's `Templates/` notes, then the built-in starters the vault doesn't have
   (by name). Used by the + sheet's Note form and /template in the editor (shared/templates.ts fills them in). */
import { STARTER_TEMPLATES, isTemplatePath } from "../../shared/templates.ts";
import type { Index } from "../../shared/index.ts";
import { readFile } from "./store";

export interface TemplateInfo { name: string; path?: string; starter: boolean }

export function templatesOf(ix: Index): TemplateInfo[] {
  const mine = [...ix.docs.values()].filter((d) => isTemplatePath(d.path) && !d.private)
    .map((d) => ({ name: d.name, path: d.path, starter: false })).sort((a, b) => a.name.localeCompare(b.name));
  const names = new Set(mine.map((t) => t.name.toLowerCase()));
  return [...mine, ...STARTER_TEMPLATES.filter((s) => !names.has(s.name.toLowerCase())).map((s) => ({ name: s.name, starter: true }))];
}

/** A template's text (its file, or the starter's). */
export function templateText(t: TemplateInfo): string {
  if (t.path) return readFile(t.path) ?? "";
  return STARTER_TEMPLATES.find((s) => s.name === t.name)?.text ?? "";
}
