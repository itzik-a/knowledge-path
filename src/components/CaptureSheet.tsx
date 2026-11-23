/* Capture: paste a link or jot a note. Links become resources (the enricher fills in the details on
   its next run); YouTube titles come right away from YouTube's own oEmbed (only the video URL is sent).
   Without a topic, it lands in the Inbox. Opened by the + button, ⌘N, or #capture?url=…&title=…&text=…
   (the iOS Shortcut and the bookmarklet). */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { guessType, isHttpUrl, RESOURCE_TYPES, titleFromUrl, type ResourceType, type Status } from "../../shared/vault.ts";
import { parseRecipeText, recipeBody } from "../../shared/recipes.ts";
import { getPassphrase } from "../lib/passphrase";
import { docHref, go } from "../lib/route";
import { openSheet } from "../lib/sheets";
import { showToast } from "../lib/toast";
import { createNote, createRecipe, createResource } from "../state/actions";
import { TopicPicker, TYPE_LABEL } from "./bits";
import { IconLock, IconUnlock } from "./Icons";
import { Field, Seg, Select, Sheet, closeSheet } from "./ui";

type Mode = "link" | "note" | "recipe";
export interface CaptureInit { url?: string; title?: string; text?: string; topics?: string[]; mode?: Mode }

const firstUrl = (s: string) => s.match(/https?:\/\/[^\s<>"]+/)?.[0];

async function youtube(url: string): Promise<{ title?: string; author?: string; image?: string } | null> {
  try {
    const h = new URL(url).hostname.replace(/^www\.|^m\./, "");
    if (!/^(youtube\.com|youtu\.be|music\.youtube\.com)$/.test(h)) return null;
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return { title: j.title, author: j.author_name, image: j.thumbnail_url };
  } catch { return null; }
}

export function CaptureSheet({ init, onClose }: { init: CaptureInit; onClose: () => void }) {
  const startUrl = init.url ?? (init.text ? firstUrl(init.text) : undefined);
  const [mode, setMode] = useState<Mode>(init.mode ?? (startUrl || !init.text ? "link" : "note"));
  const [url, setUrl] = useState(startUrl ?? "");
  const [title, setTitle] = useState(init.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!init.title);
  const [type, setType] = useState<ResourceType>(startUrl ? guessType(startUrl) ?? "article" : "article");
  const [typeTouched, setTypeTouched] = useState(false);
  const [author, setAuthor] = useState("");
  const [image, setImage] = useState<string | undefined>();
  const [status, setStatus] = useState<Status>("saved");
  const [note, setNote] = useState(init.text && init.text.trim() !== startUrl ? init.text.replace(startUrl ?? "", "").trim() : "");
  const [topics, setTopics] = useState<string[]>(init.topics ?? []);
  const [priv, setPriv] = useState(false);
  const [recipeText, setRecipeText] = useState(init.mode === "recipe" ? init.text ?? "" : "");
  const [err, setErr] = useState("");
  const form = useRef<HTMLFormElement>(null);

  // Fill in what can be known from the URL alone.
  useEffect(() => {
    const u = url.trim();
    if (!isHttpUrl(u)) return;
    if (!typeTouched) setType(guessType(u) ?? "article");
    // only a whole video link, and only once typing pauses
    if (!/youtube\.com\/(watch\?.*v=[\w-]{11}|shorts\/[\w-]{11})|youtu\.be\/[\w-]{11}/.test(u)) return;
    let live = true;
    const t = setTimeout(() => void youtube(u).then((y) => {
      if (!live || !y) return;
      if (y.title && !titleTouched) setTitle(y.title);
      if (y.author) setAuthor((a) => a || y.author!);
      setImage(y.image);
    }), 500);
    return () => { live = false; clearTimeout(t); };
  }, [url, typeTouched, titleTouched]);

  function save(e: FormEvent) {
    e.preventDefault();
    if (mode === "recipe") {
      // a link (the enricher fills it in), pasted text (split here), or just a name (written by hand)
      const u = url.trim();
      if (u && !isHttpUrl(u)) { setErr("That doesn't look like a web address (it should start with https://)."); return; }
      const pasted = recipeText.trim() ? parseRecipeText(recipeText) : null;
      const name = title.trim() || pasted?.title || (u ? titleFromUrl(u) : "");
      if (!name) { setErr("Give it a name, a link, or paste the recipe."); return; }
      const path = createRecipe({ title: name, topics, source: u || undefined, provisional: !!u && !title.trim() && !pasted?.title, body: pasted ? recipeBody(pasted) : undefined });
      if (u) showToast("Saved: the recipe is filled in from the page after the next sync");
      closeSheet(form.current);
      go(docHref(path));
      return;
    }
    if (mode === "link") {
      const u = url.trim();
      if (u && !isHttpUrl(u)) { setErr("That doesn't look like a web address (it should start with https://)."); return; }
      const t = title.trim() || (u ? titleFromUrl(u) : "");
      if (!t) { setErr("Give it a title or a link."); return; }
      const provisional = !!u && !title.trim();
      const path = createResource({ title: t, url: u || undefined, type, author: author.trim() || undefined, image, topics, status, notes: note, provisional });
      showToast(topics.length ? "Saved" : "Saved to the Inbox", { label: "Open", run: () => go(docHref(path)) });
    } else {
      const body = note.trim();
      if (!body && !title.trim()) { setErr("Write something first."); return; }
      const t = title.trim() || body.split("\n")[0].replace(/^#+\s*/, "").slice(0, 60) || "Untitled";
      const rest = title.trim() ? body : body.split("\n").slice(1).join("\n").trim();
      const path = createNote({ title: t, body: rest ? rest + "\n" : "", topics, private: priv });
      // without a passphrase the sync holds a private note back (never sent unencrypted) until one is chosen
      if (priv && !getPassphrase()) showToast("Locked note saved here. Choose a passphrase so it can go to the vault", { label: "Choose", run: () => openSheet({ kind: "private" }) });
      else showToast(priv ? "Locked note saved" : topics.length ? "Note saved" : "Note saved to the Inbox", { label: "Open", run: () => go(docHref(path)) });
    }
    closeSheet(form.current);
  }

  return (
    <Sheet title="Add" onClose={onClose}>
      <form ref={form} className="form-grid" onSubmit={save}>
        <Seg<Mode | "habit"> className="full" label="What to add" value={mode}
          onChange={(m) => { if (m === "habit") { openSheet({ kind: "habit", topics }); return; } setMode(m); setErr(""); }}
          options={[{ id: "link", label: "Link" }, { id: "note", label: "Note" }, { id: "recipe", label: "Recipe" }, { id: "habit", label: "Habit" }]} />
        {mode === "link" ? (
          <>
            <Field label="Link">
              <input className="text-input" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://…" data-autofocus={!startUrl || undefined}
                value={url} onChange={(e) => { setUrl(e.target.value); setErr(""); }} />
            </Field>
            <Field label="Title" hint={!title && url ? "Leave empty to use the page's own title." : undefined}>
              <input className="text-input" dir="auto" placeholder={url && isHttpUrl(url) ? titleFromUrl(url) : "e.g. Meditations"} value={title}
                onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }} />
            </Field>
            <div className="form-row">
              <Field label="Type">
                <Select<ResourceType> value={type} onChange={(v) => { setType(v); setTypeTouched(true); }} label="Type" options={RESOURCE_TYPES.map((t) => ({ id: t, label: TYPE_LABEL[t] }))} />
              </Field>
              <Field label="By">
                <input className="text-input" dir="auto" placeholder="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
              </Field>
            </div>
            <div className="field">
              <span className="field-label">When</span>
              <Seg<Status> label="When" value={status} onChange={setStatus} options={[{ id: "saved", label: "Someday" }, { id: "next", label: "Up next" }, { id: "in-progress", label: "Now" }]} />
            </div>
          </>
        ) : mode === "recipe" ? (
          <>
            <Field label="Link" hint="A recipe page: the ingredients, steps, times and photo are read from it.">
              <input className="text-input" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://…" data-autofocus
                value={url} onChange={(e) => { setUrl(e.target.value); setErr(""); }} />
            </Field>
            <Field label="Name" hint={url || recipeText ? "Leave empty to use the recipe's own name." : undefined}>
              <input className="text-input" dir="auto" placeholder="e.g. Shakshuka" value={title} onChange={(e) => { setTitle(e.target.value); setErr(""); }} />
            </Field>
            <Field label="Or paste the recipe" hint="From a message, a book or Notes: it's split into ingredients and steps.">
              <textarea className="text-input" dir="auto" rows={5} placeholder={"Ingredients\n2 cups flour…\n\nSteps\n1. Mix…"} value={recipeText} onChange={(e) => { setRecipeText(e.target.value); setErr(""); }} />
            </Field>
          </>
        ) : (
          <Field label="Title">
            <input className="text-input" dir="auto" placeholder="Optional: the first line is used" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <div className="field">
          <span className="field-label">Topics</span>
          <TopicPicker value={topics} onChange={setTopics} />
        </div>
        {mode !== "recipe" && (
          <Field label={mode === "link" ? "Why I saved it" : "Note"}>
            <textarea className="text-input" dir="auto" rows={mode === "note" ? 6 : 3} placeholder={mode === "link" ? "Optional" : "Write it down…"} data-autofocus={(mode === "note" && !init.text) || undefined}
              value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        {mode === "note" && (
          <div className="private-pick">
            <button type="button" className="chip" aria-pressed={priv} onClick={() => setPriv((p) => !p)}>{priv ? <IconLock className="inline-icon" /> : <IconUnlock className="inline-icon" />} {priv ? "Locked" : "Lock"}</button>
            {priv && <span className="muted small">Its text is encrypted in the vault from the first save.</span>}
          </div>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn primary" type="submit">{mode === "recipe" ? (url.trim() || recipeText.trim() ? "Save the recipe" : "Write the recipe") : mode === "link" ? "Save" : priv ? "Save locked note" : "Save note"}</button>
      </form>
    </Sheet>
  );
}
