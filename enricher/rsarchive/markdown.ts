/* Book → Obsidian-flavoured Markdown files: a folder per book with an index note (cover, the
   edition's introduction, the contents as [[links]]), one note per chapter (frontmatter with the
   book, GA, date, place, translator and source; the text; [^1] footnotes; previous / next links) and
   the images. Each numbered paragraph ends with a block id (^p12), so a note can link to
   [[02 Lecture I#^p12]] and land on that paragraph. Paths are relative to the output folder.
   For a vault whose sync keeps only text (knowledge-path), `home` names the note that is the book's
   home instead of an index note, and `images: "remote"` links to the pictures on rsarchive.org. */
import TurndownService from "turndown";
import { allChapters, displayTitle, type Book, type Chapter } from "./model.ts";

export interface MarkdownOptions {
  /** Show the site's paragraph numbers as [12] at the start of each paragraph. Default true. */
  paragraphNumbers?: boolean;
  /** Add Obsidian block ids (^p12) to numbered paragraphs. Default true. */
  blockIds?: boolean;
  /** "files" (default): download the images into <folder>/images/. "remote": link to them on the site. */
  images?: "files" | "remote";
  /** The note that is the book's home (a saved link, say): no index note is written, chapters link to it. */
  home?: string;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

/** A file name Obsidian, macOS, Windows and iOS all accept, and that [[links]] can name. */
export function safeName(s: string, max = 120): string {
  const t = s
    .replace(/\s*:\s*/g, " - ")
    .replace(/[\\/]/g, "-")
    .replace(/[*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return (t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") : t) || "Untitled";
}

const q = (s: string) => JSON.stringify(s);

function frontmatter(fields: [string, string | number | undefined][]): string {
  const lines = fields.filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${typeof v === "number" || /^\d{4}-\d\d-\d\d$/.test(String(v)) ? v : q(String(v))}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

export function bookFolder(book: Book): string {
  return safeName(book.ga ? `${book.title} (GA ${book.ga})` : book.title, 100);
}

export function markdown(book: Book, opts: MarkdownOptions = {}): Map<string, string | Uint8Array> {
  const pn = opts.paragraphNumbers ?? true;
  const blockIds = opts.blockIds ?? true;
  const folder = bookFolder(book);
  const remote = opts.images === "remote";
  const out = new Map<string, string | Uint8Array>();
  const chapters = allChapters(book);

  // Images under <folder>/images/, named after the book so [[embeds]] stay unique in a vault.
  const prefix = book.ga ? `GA ${book.ga}` : safeName(book.title, 40);
  const imageName = new Map<string, string>();
  let k = 0;
  for (const [url, img] of remote ? [] : book.images) {
    const ext = EXT[img.type] ?? "img";
    const name = url === book.cover ? `${prefix} cover.${ext}` : `${prefix} ${String(++k).padStart(3, "0")}.${ext}`;
    imageName.set(url, name);
    out.set(`${folder}/images/${name}`, img.data);
  }

  const width = String(chapters.length).length < 2 ? 2 : String(chapters.length).length;
  const noteName = new Map<string, string>();
  chapters.forEach((ch, i) => noteName.set(ch.url, safeName(`${String(i + 1).padStart(width, "0")} ${displayTitle(ch)}`)));
  const link = (ch: Chapter, text = displayTitle(ch)) => `[[${noteName.get(ch.url)}|${text.replace(/[|[\]]/g, "")}]]`;

  const td = new TurndownService({ headingStyle: "atx", emDelimiter: "*", bulletListMarker: "-", hr: "---" });
  td.addRule("paragraphNumber", {
    filter: (node) => node.nodeName === "SPAN" && (node as HTMLElement).getAttribute("class") === "pn",
    replacement: (content) => (pn ? `\\[${content}\\]` : ""),
  });
  td.addRule("footnoteRef", {
    filter: (node) => node.nodeName === "SUP" && (node as HTMLElement).getAttribute("class") === "fnref",
    replacement: (_c, node) => {
      const key = ((node as HTMLElement).querySelector("a")?.getAttribute("href") ?? "").replace(/^#fn-/, "");
      return `[^${key}]`;
    },
  });
  td.addRule("numberedParagraph", {
    filter: (node) => node.nodeName === "P" && /^p-/.test((node as HTMLElement).getAttribute("id") ?? ""),
    replacement: (content, node) => {
      const id = ((node as HTMLElement).getAttribute("id") ?? "").replace(/^p-/, "p").replace(/[^\w-]/g, "-");
      return `\n\n${content.trim()}${blockIds ? ` ^${id}` : ""}\n\n`;
    },
  });
  td.addRule("image", {
    filter: "img",
    replacement: (_c, node) => {
      const el = node as HTMLElement;
      const src = el.getAttribute("src") ?? "";
      const alt = (el.getAttribute("alt") ?? "").replace(/[|[\]]/g, "").trim();
      if (remote) return src ? `![${alt}](${src.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20")})` : "";
      const name = imageName.get(src);
      if (!name) return "";
      return `![[${name}${alt ? `|${alt}` : ""}]]`;
    },
  });
  td.addRule("figure", { filter: "figure", replacement: (content) => `\n\n${content.trim()}\n\n` });
  td.addRule("chapterLink", {
    filter: (node) => node.nodeName === "A" && noteName.has(((node as HTMLElement).getAttribute("href") ?? "").split("#")[0]),
    replacement: (content, node) => {
      const href = (node as HTMLElement).getAttribute("href") ?? "";
      return `[[${noteName.get(href.split("#")[0])}|${content.replace(/[|[\]]/g, "")}]]`;
    },
  });
  const md = (html: string) => td.turndown(html).replace(/\n{3,}/g, "\n\n").trim();

  // The index note (unless another note is the book's home).
  const homeName = opts.home ?? folder;
  const bookLink = `[[${homeName}]]`;
  const coverName = book.cover ? imageName.get(book.cover) : undefined;
  const index: string[] = [
    frontmatter([
      ["title", book.title],
      ["subtitle", book.subtitle],
      ["author", book.author],
      ["ga", book.ga],
      ["translator", book.translator],
      ["edition", book.edition],
      ["lang", book.lang],
      ["source", book.sourceUrl],
      ["cover", coverName ? `[[${coverName}]]` : undefined],
      ["chapters", chapters.length],
    ]),
  ];
  if (coverName) index.push(`![[${coverName}|200]]\n`);
  if (book.description) index.push(md(book.description) + "\n");
  index.push(book.lang === "de" ? "## Inhalt\n" : "## Contents\n");
  for (const s of book.sections) {
    if (s.heading) index.push(`### ${s.heading}\n`);
    for (const ch of s.chapters) index.push(`- ${link(ch)}${ch.dateLine ? ` — ${ch.dateLine}` : ""}`);
    index.push("");
  }
  index.push(`Source: ${book.sourceUrl}`);
  if (!opts.home) out.set(`${folder}/${folder}.md`, index.join("\n").trim() + "\n");

  // One note per chapter.
  chapters.forEach((ch, i) => {
    const parts: string[] = [
      frontmatter([
        ["title", displayTitle(ch)],
        ["book", bookLink],
        ["author", book.author],
        ["ga", book.ga],
        ["order", i + 1],
        ["section", book.sections.find((s) => s.chapters.includes(ch))?.heading],
        ["date", ch.date],
        ["place", ch.place],
        ["translator", ch.translator ?? book.translator],
        ["source", ch.url],
        ["german", ch.germanUrl],
        ["summary", ch.summary],
      ]),
    ];
    if (ch.dateLine) parts.push(`*${ch.dateLine}*\n`);
    parts.push(md(ch.html));
    if (ch.footnotes.length) {
      parts.push("");
      for (const f of ch.footnotes) parts.push(`[^${f.key}]: ${md(f.html).replace(/\n\n/g, "\n\n    ")}`);
    }
    const prev = chapters[i - 1];
    const next = chapters[i + 1];
    parts.push("\n---\n", [prev ? `← ${link(prev)}` : "", `[[${homeName}|${book.lang === "de" ? "Inhalt" : "Contents"}]]`, next ? `${link(next)} →` : ""].filter(Boolean).join(" · "));
    out.set(`${folder}/${noteName.get(ch.url)}.md`, parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n");
  });

  return out;
}
