import { XMLValidator } from "fast-xml-parser";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { epub } from "../../enricher/rsarchive/epub.ts";
import { markdown, safeName } from "../../enricher/rsarchive/markdown.ts";
import { displayTitle } from "../../enricher/rsarchive/model.ts";
import { contents, scrape } from "../../enricher/rsarchive/scrape.ts";
import { fixtureFetcher, urlOf } from "./helpers.ts";

const opts = () => ({ fetcher: fixtureFetcher() });

describe("contents", () => {
  it("takes the English edition from a book's GA overview, with the overview's title", async () => {
    const c = await contents(urlOf("book-overview"), opts());
    expect(c.title).toBe("The Riddles of Philosophy");
    expect(c.sourceUrl).toBe(urlOf("book-index"));
    expect(c.edition).toMatch(/^Anthroposophic Press/);
    expect(c.entries).toHaveLength(22);
  });

  it("takes the German edition with --lang de", async () => {
    await expect(contents(urlOf("book-overview"), { ...opts(), lang: "de" })).rejects.toThrow(/German/); // its page isn't a fixture: 404
  });

  it("builds a lecture cycle from a GA overview, one translation per lecture", async () => {
    const c = await contents(urlOf("lecture-overview"), opts());
    expect(c.title).toBe("Meditative Reflections and Guidance for Deepening the Art of Healing");
    expect(c.entries[0]).toMatchObject({ url: "https://rsarchive.org/Lectures/YoungDoctors/19240102p01.html", date: "1924-01-02", place: "Dornach" });
    // Lecture 16 exists only in the SOL translation, so the book has a section per edition…
    expect([...new Set(c.entries.map((e) => e.section))]).toEqual(["Course for Young Doctors", "Meditative Reflections and Guidance for Deepening the Art of Healing"]);
    // …and the cover and introduction come from the edition most lectures are from.
    expect(c.cover).toBe("https://rsarchive.org/Covers/youngdoctors_covs.jpg");
    expect(c.choices?.map((ch) => ch.chosen)).toContain(true);
  });

  it("prefers the translation asked for", async () => {
    const c = await contents(urlOf("lecture-overview"), { ...opts(), translation: "SOL" });
    expect(c.entries[0].url).toBe("https://rsarchive.org/Lectures/GA316/English/SOL/19240102.html");
    expect(c.entries.every((e) => e.url.includes("/SOL/"))).toBe(true);
  });

  it("follows a chapter's table of contents to its book", async () => {
    const c = await contents(urlOf("lecture-chapter-footnotes"), opts());
    expect(c.sourceUrl).toBe(urlOf("lecture-index"));
    expect(c.entries).toHaveLength(9);
  });

  it("makes a book of one chapter with --single", async () => {
    const c = await contents(urlOf("lecture-chapter-footnotes"), { ...opts(), single: true });
    expect(c.entries.map((e) => e.url)).toEqual([urlOf("lecture-chapter-footnotes")]);
  });
});

/** GA 283 with only Lecture I available: the other pages 404 and are reported, not fatal. */
async function ga283() {
  const o = opts();
  const c = await contents(urlOf("lecture-index"), o);
  return scrape(c, o);
}

describe("scrape", () => {
  it("keeps going when a page fails, and says which", async () => {
    const { book, failed } = await ga283();
    expect(book.sections.flatMap((s) => s.chapters).map((ch) => ch.url)).toEqual([urlOf("lecture-chapter-footnotes")]);
    expect(failed).toHaveLength(8);
    expect(book.translator).toBe("Maria St. Goar");
    expect(book.cover).toBe("https://rsarchive.org/Covers/inatmusic_covs.jpg");
    expect(book.images.get(book.cover!)?.type).toBe("image/png");
  });

  it("titles a chapter with the contents label when it adds something", () => {
    expect(displayTitle({ label: "Lecture I", title: "The Inner Nature of Music I" })).toBe("Lecture I: The Inner Nature of Music I");
    expect(displayTitle({ label: "Guiding Thoughts", title: "I. Guiding Thoughts" })).toBe("I. Guiding Thoughts");
    expect(displayTitle({ label: "Lecture I", title: "Lecture I" })).toBe("Lecture I");
  });
});

describe("epub", () => {
  it("is a valid package: mimetype first and stored, every file well-formed, manifest and spine complete", async () => {
    const { book } = await ga283();
    const bytes = epub(book, { modified: new Date("2026-01-01T00:00:00Z") });

    // mimetype: the first local file header, stored (method 0), named "mimetype", no extra field.
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint16(28, true)).toBe(0);
    expect(strFromU8(bytes.subarray(30, 38))).toBe("mimetype");
    expect(strFromU8(bytes.subarray(38, 58))).toBe("application/epub+zip");

    const files = unzipSync(bytes);
    for (const [name, data] of Object.entries(files)) {
      if (/\.(xhtml|opf|ncx|xml)$/.test(name)) expect(XMLValidator.validate(strFromU8(data)), name).toBe(true);
    }
    const opf = strFromU8(files["OEBPS/content.opf"]);
    const items = [...opf.matchAll(/<item id="([^"]+)" href="([^"]+)"/g)];
    for (const [, , href] of items) expect(files[`OEBPS/${href}`], href).toBeDefined();
    const ids = new Set(items.map((m) => m[1]));
    for (const [, idref] of opf.matchAll(/<itemref idref="([^"]+)"/g)) expect(ids.has(idref)).toBe(true);
    for (const name of Object.keys(files)) if (name.startsWith("OEBPS/") && name !== "OEBPS/content.opf") expect(items.some(([, , h]) => `OEBPS/${h}` === name), name).toBe(true);

    expect(opf).toContain('<dc:creator id="author">Rudolf Steiner</dc:creator>');
    expect(opf).toContain('<meta refines="#ga" property="group-position">283</meta>');
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain("<meta property=\"dcterms:modified\">2026-01-01T00:00:00Z</meta>");
  });

  it("turns footnotes into pop-up notes that link both ways", async () => {
    const { book } = await ga283();
    const ch = strFromU8(unzipSync(epub(book))["OEBPS/ch001.xhtml"]);
    expect(ch).toContain('<a epub:type="noteref" role="doc-noteref" href="#fn-1" id="fnref-1">1</a>');
    expect(ch).toContain('<aside epub:type="footnote" role="doc-footnote" id="fn-1">\n<p><a href="#fnref-1">1.</a> Rudolph Steiner distinguishes');
    expect(ch).toContain('<p class="dateline">3 December 1906, Cologne</p>');
    expect(ch).toContain('<span class="pn">1</span> For those who care');
  });

  it("can leave out paragraph numbers", async () => {
    const { book } = await ga283();
    const ch = strFromU8(unzipSync(epub(book, { paragraphNumbers: false }))["OEBPS/ch001.xhtml"]);
    expect(ch).not.toContain('class="pn"');
    expect(ch).toContain('<p id="p-1">For those who care');
  });

  it("keeps the same identifier when rebuilt", async () => {
    const a = strFromU8(unzipSync(epub((await ga283()).book))["OEBPS/content.opf"]);
    const b = strFromU8(unzipSync(epub((await ga283()).book))["OEBPS/content.opf"]);
    const id = (s: string) => /<dc:identifier id="bookid">([^<]+)</.exec(s)?.[1];
    expect(id(a)).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id(a)).toBe(id(b));
  });
});

describe("markdown", () => {
  it("writes an index note, chapter notes with frontmatter, footnotes, block ids and images", async () => {
    const { book } = await ga283();
    const files = markdown(book);
    const folder = "The Inner Nature of Music and the Experience of Tone (GA 283)";
    expect([...files.keys()].sort()).toEqual([`${folder}/01 Lecture I - The Inner Nature of Music I.md`, `${folder}/${folder}.md`, `${folder}/images/GA 283 cover.png`].sort());

    const note = files.get(`${folder}/01 Lecture I - The Inner Nature of Music I.md`) as string;
    expect(note).toMatch(/^---\ntitle: "Lecture I: The Inner Nature of Music I"\nbook: "\[\[The Inner Nature of Music and the Experience of Tone \(GA 283\)\]\]"\n/);
    expect(note).toContain("\ndate: 1906-12-03\n");
    expect(note).toContain("\n\\[1\\] For those who care to reflect on it");
    expect(note).toMatch(/For those who care to reflect on it.*\^p1\n/);
    expect(note).toContain("[^1] is incorporated");
    expect(note).toContain("\n[^1]: Rudolph Steiner distinguishes here");

    const index = files.get(`${folder}/${folder}.md`) as string;
    expect(index).toContain("![[GA 283 cover.png|200]]");
    expect(index).toContain("- [[01 Lecture I - The Inner Nature of Music I|Lecture I: The Inner Nature of Music I]] — 3 December 1906, Cologne");
  });

  it("in vault mode, links to a home note and to images on the site, with no index note", async () => {
    const o = opts();
    const { book } = await scrape(await contents(urlOf("lecture-chapter-images"), { ...o, single: true }), o);
    const files = markdown(book, { home: "World History", images: "remote" });
    const folder = "World History in the Light of Anthroposophy - Lecture I (GA 233)";
    expect([...files.keys()]).toEqual([`${folder}/01 Lecture I.md`]);
    const note = files.get(`${folder}/01 Lecture I.md`) as string;
    expect(note).toContain('\nbook: "[[World History]]"\n');
    expect(note).toContain("![Earth's atmosphere turning towards the Sun](https://rsarchive.org/Lectures/GA233/English/RSP1977/images/19231224d01_01.gif)");
    expect(note).toContain("[[World History|Contents]]");
  });

  it("names files safely", () => {
    expect(safeName('Lecture I: "What/Why?" #2')).toBe("Lecture I - What-Why 2");
    expect(safeName("Ends with a dot.")).toBe("Ends with a dot");
  });
});
