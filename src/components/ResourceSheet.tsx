/* Edit a resource's details: title (renames the file), link, type, author, site, year. */
import { useRef, useState, type FormEvent } from "react";
import { isHttpUrl, RESOURCE_TYPES, type ResourceType } from "../../shared/vault.ts";
import { docHref, go } from "../lib/route";
import { patchResource, retitle } from "../state/actions";
import { useIndex } from "../state/store";
import { TYPE_LABEL } from "./bits";
import { Field, Select, Sheet, closeSheet } from "./ui";

export function ResourceSheet({ path, onClose }: { path: string; onClose: () => void }) {
  const ix = useIndex();
  const d = ix.docs.get(path);
  const r = d?.resource;
  const [title, setTitle] = useState(d?.title ?? "");
  const [url, setUrl] = useState(r?.url ?? "");
  const [type, setType] = useState<ResourceType>(r?.type ?? "article");
  const [author, setAuthor] = useState(r?.author ?? "");
  const [site, setSite] = useState(r?.site ?? "");
  const [year, setYear] = useState(r?.year ?? "");
  const [err, setErr] = useState("");
  const form = useRef<HTMLFormElement>(null);
  if (!d || !r) return null;

  function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("It needs a title."); return; }
    if (url.trim() && !isHttpUrl(url.trim())) { setErr("The link should start with https://"); return; }
    const urlChanged = url.trim() !== (r!.url ?? "");
    patchResource(path, {
      url: url.trim() || undefined, type, author: author.trim() || undefined, site: site.trim() || undefined, year: year.trim() || undefined,
      enrich: urlChanged && url.trim() ? "pending" : r!.enrich,
    });
    const next = title.trim() !== d!.title ? retitle(path, title) : path;
    closeSheet(form.current);
    if (next !== path) go(docHref(next));
  }

  return (
    <Sheet title="Details" onClose={onClose}>
      <form ref={form} className="form-grid" onSubmit={save}>
        <Field label="Title"><input className="text-input" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Link"><input className="text-input" type="url" inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
        <div className="form-row">
          <Field label="Type"><Select<ResourceType> value={type} onChange={setType} label="Type" options={RESOURCE_TYPES.map((t) => ({ id: t, label: TYPE_LABEL[t] }))} /></Field>
          <Field label="Year"><input className="text-input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 1942" /></Field>
        </div>
        <Field label="By"><input className="text-input" dir="auto" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author, speaker, channel" /></Field>
        <Field label="Published in"><input className="text-input" dir="auto" value={site} onChange={(e) => setSite(e.target.value)} placeholder="Site, publisher, podcast" /></Field>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn primary" type="submit">Save</button>
      </form>
    </Sheet>
  );
}
