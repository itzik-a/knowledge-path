/* Book → EPUB 3 (with an EPUB 2 toc.ncx too, for older readers). Footnotes are
   <aside epub:type="footnote">, which Apple Books, Kobo and Kindle show as pop-ups; parts become
   nested entries in the contents; the GA number is the book's position in a "Gesamtausgabe" series
   (EPUB 3 collection and Calibre's series fields). The zip has `mimetype` first and uncompressed,
   as the format requires. */
import { createHash } from "node:crypto";
import { strToU8, zipSync, type Zippable } from "fflate";
import { esc, escAttr } from "./html.ts";
import { allChapters, displayTitle, type Book, type Chapter } from "./model.ts";

export interface EpubOptions {
  /** Show the site's paragraph numbers ([ 1 ], [ 2 ] …). Default true. */
  paragraphNumbers?: boolean;
  /** The time stamped as last modified (tests pass a fixed one). */
  modified?: Date;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

const CSS = `body { font-family: Georgia, "Times New Roman", serif; line-height: 1.5; margin: 0 0.6em; }
h1 { font-size: 1.45em; line-height: 1.25; margin: 1.2em 0 0.3em; }
h2, h3 { font-size: 1.15em; margin: 1.4em 0 0.5em; }
header { margin-bottom: 1.6em; }
header p { margin: 0; font-style: italic; opacity: 0.75; }
p { margin: 0 0 0.75em; }
.pn { font-family: sans-serif; font-size: 0.65em; opacity: 0.55; margin-right: 0.25em; vertical-align: 0.1em; }
sup.fnref { line-height: 0; }
sup.fnref a { text-decoration: none; }
figure { margin: 1.2em 0; text-align: center; }
img { max-width: 100%; height: auto; }
blockquote { margin: 1em 1.4em; }
table { border-collapse: collapse; margin: 1em 0; }
td, th { padding: 0.2em 0.5em; vertical-align: top; }
.center { text-align: center; }
.right { text-align: right; }
section.footnotes { margin-top: 2.5em; border-top: 1px solid currentColor; padding-top: 0.5em; font-size: 0.9em; }
section.footnotes aside p { margin: 0.4em 0; }
.titlepage { text-align: center; margin-top: 3em; }
.titlepage h1 { font-size: 1.9em; margin-bottom: 0.4em; }
.titlepage .subtitle { font-size: 1.15em; font-style: italic; }
.titlepage .author { font-size: 1.2em; margin-top: 1.5em; }
.titlepage .ga { opacity: 0.7; }
.about { margin-top: 3em; }
.source { margin-top: 2em; font-size: 0.85em; opacity: 0.75; word-wrap: break-word; }
nav ol { list-style: none; padding-left: 0; }
nav ol ol { padding-left: 1.2em; }
nav li { margin: 0.3em 0; }
body.cover { margin: 0; padding: 0; text-align: center; }
body.cover img { max-height: 100%; }
`;

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** A stable urn:uuid from the source URL, so a rebuilt book replaces the old one in a reader's library. */
export function bookId(book: Book): string {
  const h = createHash("sha1").update(`rsarchive-to-epub:${book.sourceUrl}`).digest("hex");
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function xhtml(lang: string, title: string, body: string, bodyAttrs = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head>
<meta charset="UTF-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body${bodyAttrs}>
${body}
</body>
</html>
`;
}

export function epub(book: Book, opts: EpubOptions = {}): Uint8Array {
  const pn = opts.paragraphNumbers ?? true;
  const lang = book.lang;
  const chapters = allChapters(book);
  const files: Zippable = {};
  const manifest: string[] = [];
  const spine: string[] = [];

  // Images: the cover as images/cover.*, the rest numbered in order of appearance.
  const imageFile = new Map<string, string>();
  let k = 0;
  for (const [url, img] of book.images) {
    const name = url === book.cover ? `images/cover.${EXT[img.type] ?? "img"}` : `images/${String(++k).padStart(3, "0")}.${EXT[img.type] ?? "img"}`;
    imageFile.set(url, name);
    files[`OEBPS/${name}`] = [img.data, { level: 0 }];
    const id = url === book.cover ? "cover-image" : `img${k}`;
    manifest.push(`<item id="${id}" href="${name}" media-type="${img.type}"${url === book.cover ? ' properties="cover-image"' : ""}/>`);
  }

  const chapterFile = new Map<string, string>();
  chapters.forEach((ch, i) => chapterFile.set(ch.url, `ch${String(i + 1).padStart(3, "0")}.xhtml`));

  const rewrite = (html: string) => {
    let out = html.replace(/<img src="([^"]*)" alt="([^"]*)"\/>/g, (_, src: string, alt: string) => {
      const local = imageFile.get(unesc(src));
      return local ? `<img src="${local}" alt="${alt}"/>` : "";
    });
    out = out.replace(/<figure>\s*<\/figure>\n?/g, "");
    out = out.replace(/<a href="([^"#]*)(#[^"]*)?"/g, (m, href: string, hash = "") => {
      const local = chapterFile.get(unesc(href));
      return local ? `<a href="${local}${hash}"` : m;
    });
    out = out.replace(/<a href="#fn-([^"]+)" id="fnref-/g, '<a epub:type="noteref" role="doc-noteref" href="#fn-$1" id="fnref-');
    if (!pn) out = out.replace(/<span class="pn">[^<]*<\/span> ?/g, "");
    return out;
  };

  // Cover page.
  if (book.cover && imageFile.has(book.cover)) {
    files["OEBPS/cover.xhtml"] = strToU8(
      xhtml(lang, "Cover", `<section epub:type="cover"><img src="${imageFile.get(book.cover)}" alt="Cover"/></section>`, ' class="cover"'),
    );
    manifest.push('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="cover"/>');
  }

  // Title page, with the edition's introduction and where the text came from.
  const tp: string[] = ['<section epub:type="titlepage" class="titlepage">', `<h1>${esc(book.title)}</h1>`];
  if (book.subtitle) tp.push(`<p class="subtitle">${esc(book.subtitle)}</p>`);
  tp.push(`<p class="author">${esc(book.author)}</p>`);
  if (book.ga) tp.push(`<p class="ga">GA ${esc(book.ga)}</p>`);
  if (book.translator) tp.push(`<p class="translator">${lang === "de" ? "" : "Translated by "}${esc(book.translator)}</p>`);
  if (book.edition) tp.push(`<p class="edition">${esc(book.edition)}</p>`);
  tp.push("</section>");
  if (book.description) tp.push(`<section class="about">\n${rewrite(book.description)}\n</section>`);
  tp.push(`<p class="source">From the Rudolf Steiner Archive, <a href="${escAttr(book.sourceUrl)}">${esc(book.sourceUrl)}</a></p>`);
  files["OEBPS/title.xhtml"] = strToU8(xhtml(lang, book.title, tp.join("\n")));
  manifest.push('<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>');
  spine.push('<itemref idref="titlepage"/>');

  // Contents (nav), shown after the title page.
  const navItem = (ch: Chapter) => `<li><a href="${chapterFile.get(ch.url)}">${esc(displayTitle(ch))}</a></li>`;
  const navList = book.sections
    .map((s) =>
      s.heading
        ? `<li><a href="${chapterFile.get(s.chapters[0].url)}">${esc(s.heading)}</a>\n<ol>\n${s.chapters.map(navItem).join("\n")}\n</ol></li>`
        : s.chapters.map(navItem).join("\n"),
    )
    .join("\n");
  const firstFile = chapterFile.get(chapters[0].url);
  const contentsWord = lang === "de" ? "Inhalt" : "Contents";
  const nav = `<nav epub:type="toc" role="doc-toc" id="toc">
<h1>${contentsWord}</h1>
<ol>
${navList}
</ol>
</nav>
<nav epub:type="landmarks" hidden="hidden">
<ol>
${book.cover && imageFile.has(book.cover) ? '<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>\n' : ""}<li><a epub:type="titlepage" href="title.xhtml">Title page</a></li>
<li><a epub:type="toc" href="nav.xhtml">${contentsWord}</a></li>
<li><a epub:type="bodymatter" href="${firstFile}">${esc(displayTitle(chapters[0]))}</a></li>
</ol>
</nav>`;
  files["OEBPS/nav.xhtml"] = strToU8(xhtml(lang, contentsWord, nav));
  manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  spine.push('<itemref idref="nav"/>');

  // Chapters.
  chapters.forEach((ch, i) => {
    const file = chapterFile.get(ch.url)!;
    const id = `ch${i + 1}`;
    const head = [`<h1>${esc(displayTitle(ch))}</h1>`];
    if (ch.dateLine) head.push(`<p class="dateline">${esc(ch.dateLine)}</p>`);
    if (ch.translator && ch.translator !== book.translator) head.push(`<p class="translator">Translated by ${esc(ch.translator)}</p>`);
    let body = `<section epub:type="chapter" role="doc-chapter">\n<header>\n${head.join("\n")}\n</header>\n${rewrite(ch.html)}\n</section>`;
    if (ch.footnotes.length) {
      const notes = ch.footnotes.map((f) => {
        const back = `<a href="#fnref-${escAttr(f.key)}">${esc(f.n)}.</a> `;
        const inner = rewrite(f.html);
        const html = /^<p[ >]/.test(inner) ? inner.replace(/^<p([^>]*)>/, `<p$1>${back}`) : `<p>${back}${inner}</p>`;
        return `<aside epub:type="footnote" role="doc-footnote" id="fn-${escAttr(f.key)}">\n${html}\n</aside>`;
      });
      body += `\n<section class="footnotes" epub:type="footnotes">\n${notes.join("\n")}\n</section>`;
    }
    files[`OEBPS/${file}`] = strToU8(xhtml(lang, displayTitle(ch), body));
    manifest.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
  });

  files["OEBPS/style.css"] = strToU8(CSS);
  manifest.push('<item id="css" href="style.css" media-type="text/css"/>');

  // toc.ncx for EPUB 2 readers.
  let order = 0;
  const point = (label: string, src: string, inner = "") =>
    `<navPoint id="np${++order}" playOrder="${order}"><navLabel><text>${esc(label)}</text></navLabel><content src="${src}"/>${inner}</navPoint>`;
  const points = book.sections
    .map((s) => {
      if (!s.heading) return s.chapters.map((ch) => point(displayTitle(ch), chapterFile.get(ch.url)!)).join("\n");
      const head = point(s.heading, chapterFile.get(s.chapters[0].url)!, "\n__INNER__\n");
      const inner = s.chapters.map((ch) => point(displayTitle(ch), chapterFile.get(ch.url)!)).join("\n");
      return head.replace("__INNER__", inner);
    })
    .join("\n");
  const id = bookId(book);
  files["OEBPS/toc.ncx"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
<head><meta name="dtb:uid" content="${id}"/></head>
<docTitle><text>${esc(book.title)}</text></docTitle>
<navMap>
${points}
</navMap>
</ncx>
`);
  manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');

  // Package document.
  const modified = (opts.modified ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z");
  const meta: string[] = [
    `<dc:identifier id="bookid">${id}</dc:identifier>`,
    `<dc:title id="title">${esc(book.title)}</dc:title>`,
    '<meta refines="#title" property="title-type">main</meta>',
  ];
  if (book.subtitle) meta.push(`<dc:title id="subtitle">${esc(book.subtitle)}</dc:title>`, '<meta refines="#subtitle" property="title-type">subtitle</meta>');
  meta.push(
    `<dc:creator id="author">${esc(book.author)}</dc:creator>`,
    '<meta refines="#author" property="role" scheme="marc:relators">aut</meta>',
    '<meta refines="#author" property="file-as">Steiner, Rudolf</meta>',
  );
  if (book.translator) meta.push(`<dc:contributor id="trl">${esc(book.translator)}</dc:contributor>`, '<meta refines="#trl" property="role" scheme="marc:relators">trl</meta>');
  meta.push(`<dc:language>${lang}</dc:language>`, `<dc:source>${esc(book.sourceUrl)}</dc:source>`);
  const about = (book.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (about) meta.push(`<dc:description>${esc(about)}</dc:description>`);
  const gaNum = book.ga ? parseInt(book.ga, 10) : NaN;
  if (book.ga) {
    meta.push('<meta property="belongs-to-collection" id="ga">Rudolf Steiner Gesamtausgabe</meta>', '<meta refines="#ga" property="collection-type">series</meta>');
    if (!Number.isNaN(gaNum)) meta.push(`<meta refines="#ga" property="group-position">${gaNum}</meta>`);
    meta.push('<meta name="calibre:series" content="Rudolf Steiner Gesamtausgabe"/>');
    if (!Number.isNaN(gaNum)) meta.push(`<meta name="calibre:series_index" content="${gaNum}"/>`);
  }
  if (book.cover && imageFile.has(book.cover)) meta.push('<meta name="cover" content="cover-image"/>');
  meta.push(`<meta property="dcterms:modified">${modified}</meta>`);

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${meta.join("\n")}
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${spine.join("\n")}
</spine>
</package>
`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

  const mtime = opts.modified ?? new Date();
  const zip: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opf),
    ...files,
  };
  return zipSync(zip, { level: 9, mtime });
}
