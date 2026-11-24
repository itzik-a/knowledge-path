import { describe, expect, it } from "vitest";
import { kindOf, parseBookOverview, parseChapter, parseDate, parseDateLine, parseHeading, parseIndex, parseLectureOverview, tidyHeading } from "../../enricher/rsarchive/parse.ts";
import { parseDoc } from "../../enricher/rsarchive/html.ts";
import { fixture, urlOf } from "./helpers.ts";

const chapter = (name: string) => parseChapter(fixture(name), urlOf(name));

describe("page kinds", () => {
  it.each([
    ["book-overview", "book-overview"],
    ["book-index", "index"],
    ["book-chapter", "chapter"],
    ["lecture-index", "index"],
    ["lecture-index-headings", "index"],
    ["lecture-overview", "lecture-overview"],
    ["lecture-chapter-footnotes", "chapter"],
    ["lecture-chapter-sol", "chapter"],
    ["lecture-chapter-german", "chapter"],
    ["lecture-chapter-images", "chapter"],
  ])("%s is a %s page", (name, kind) => {
    expect(kindOf(fixture(name))).toBe(kind);
  });

  it("knows the site's not-found page", () => {
    expect(kindOf(`<div id="centerPanel"><div class="articleBox"><h2>Page not Found</h2></div></div>`)).toBe("not-found");
  });
});

describe("headings and dates", () => {
  it("splits a heading into title, subtitle and GA number", () => {
    const h = parseHeading(parseDoc(`<h2>Meditative Reflections<br>for Healing<br><small>Lectures for Physicians<br><a href="/x">GA 316</a></small></h2>`).querySelector("h2"));
    expect(h).toEqual({ title: "Meditative Reflections for Healing", extra: ["Lectures for Physicians"], ga: "316" });
  });

  it("finds a GA number written into the title", () => {
    expect(parseHeading(parseDoc(`<h2>Truth and Science — GA 3</h2>`).querySelector("h2"))).toMatchObject({ title: "Truth and Science", ga: "3" });
  });

  it("reads English and German dates", () => {
    expect(parseDate("3 December 1906")?.date).toBe("1906-12-03");
    expect(parseDate("December 03, 1906")?.date).toBe("1906-12-03");
    expect(parseDate("2 Jan 1924")?.date).toBe("1924-01-02");
    expect(parseDate("2. Januar 1924")?.date).toBe("1924-01-02");
    expect(parseDate("Foreword")).toBeUndefined();
    expect(parseDateLine("3 December 1906, Cologne")).toEqual({ date: "1906-12-03", place: "Cologne" });
  });

  it("tidies headings written in capitals", () => {
    expect(tidyHeading("PART I")).toBe("Part I");
    expect(tidyHeading("THE EASTER COURSE")).toBe("The Easter Course");
    expect(tidyHeading("Christmas Course")).toBe("Christmas Course");
  });
});

describe("GA overviews", () => {
  it("lists a book's editions with their language and publication line", () => {
    const ov = parseBookOverview(fixture("book-overview"), urlOf("book-overview"));
    expect(ov.title).toBe("The Riddles of Philosophy");
    expect(ov.ga).toBe("18");
    expect(ov.editions.map((e) => [e.lang, e.url])).toEqual([
      ["en", "https://rsarchive.org/Books/GA018/English/AP1973/GA018_index.html"],
      ["de", "https://rsarchive.org/Books/GA018/German/GA018_index.html"],
    ]);
    expect(ov.editions[0].note).toMatch(/^Anthroposophic Press, Spring Valley, New York, 1973/);
  });

  it("lists lectures with every translation, the date, the city and the German original", () => {
    const ov = parseLectureOverview(fixture("lecture-overview"), urlOf("lecture-overview"));
    expect(ov.ga).toBe("316");
    expect(ov.subtitle).toBe("Lectures for Physicians and Medical Students");
    expect(ov.lectures.length).toBeGreaterThan(8);
    const first = ov.lectures[0];
    expect(first).toMatchObject({ n: 1, date: "1924-01-02", place: "Dornach", germanUrl: "https://rsarchive.org/Lectures/GA316/German/19240102.html" });
    expect(first.translations.map((t) => t.url)).toEqual([
      "https://rsarchive.org/Lectures/YoungDoctors/19240102p01.html",
      "https://rsarchive.org/Lectures/GA316/English/SOL/19240102.html",
    ]);
    expect(first.translations[0]).toMatchObject({ edition: "Course for Young Doctors", translator: "Gerald F. Karnow" });
  });
});

describe("contents pages", () => {
  it("reads a book's contents with its parts", () => {
    const ix = parseIndex(fixture("book-index"), urlOf("book-index"));
    expect(ix.ga).toBe("18");
    expect(ix.cover).toBe("https://rsarchive.org/Covers/riddlephil_covs.jpg");
    expect(ix.description).toMatch(/^<p>This volume is a translation of <i>Die Rätsel der Philosophie<\/i>/);
    expect(ix.description).not.toContain("<img");
    expect(ix.entries).toHaveLength(22);
    expect(ix.entries[0]).toMatchObject({ label: "Introduction", section: undefined });
    expect(ix.entries[4]).toMatchObject({ label: "Guiding Thoughts on the Method of Presentation", section: "Part I" });
    expect(ix.entries.at(-1)).toMatchObject({ section: "Part II", url: "https://rsarchive.org/Books/GA018/English/AP1973/GA018_p02c08.html" });
  });

  it("reads a lecture cycle's contents with dates", () => {
    const ix = parseIndex(fixture("lecture-index"), urlOf("lecture-index"));
    expect(ix.entries.map((e) => e.label)).toEqual(["Foreword", "Lecture I", "Lecture II", "Lecture III", "Lecture IV", "Lecture V", "Lecture VI", "Lecture VII", "Editors Note"]);
    expect(ix.entries[1]).toMatchObject({ date: "1906-12-03", url: "https://rsarchive.org/Lectures/GA283/English/AP1983/19061203p02.html" });
  });

  it("reads section rows and each lecture's summary", () => {
    const ix = parseIndex(fixture("lecture-index-headings"), urlOf("lecture-index-headings"));
    expect([...new Set(ix.entries.map((e) => e.section))]).toEqual([undefined, "Christmas Course", "Easter Course", "Appendix"]);
    expect(ix.entries[1]).toMatchObject({ label: "Lecture I", date: "1924-01-02", section: "Christmas Course" });
    expect(ix.entries[1].summary).toMatch(/^Illusion of solidly contained/);
    expect(ix.entries[0].summary).toBeUndefined();
  });
});

describe("chapters", () => {
  it("takes the title, translator and contents link, and only the text", () => {
    const ch = chapter("book-chapter");
    expect(ch).toMatchObject({
      bookTitle: "Riddles of Philosophy",
      ga: "18",
      part: "Part I",
      title: "II. The World Conception of the Greek Thinkers",
      translator: "Fritz C. A. Koelln",
      tocUrl: "https://rsarchive.org/Books/GA018/English/AP1973/",
    });
    expect(ch.html).toMatch(/^<p id="p-1"><span class="pn">1<\/span> With Pherekydes/);
    for (const junk of ["Previous", "Table of Contents", ">Compare<", "DONATE", "Soul Calendar", "<h3", "<script", "<button"]) expect(ch.html).not.toContain(junk);
  });

  it("numbers paragraphs and gives them ids", () => {
    const ch = chapter("book-chapter");
    expect(ch.html.match(/<p id="p-\d+">/g)?.length).toBe(67);
    expect(ch.html).toContain('<p id="p-67"><span class="pn">67</span> We see a personality in Plotinus');
  });

  it("moves footnotes out of the sentence and leaves a reference", () => {
    const ch = chapter("lecture-chapter-footnotes");
    expect(ch).toMatchObject({ dateLine: "3 December 1906, Cologne", date: "1906-12-03", place: "Cologne", translator: "Maria St. Goar" });
    expect(ch.footnotes.map((f) => f.n)).toEqual(["1", "2"]);
    expect(ch.footnotes[0].html).toMatch(/^Rudolph Steiner distinguishes here/);
    expect(ch.html).toContain('<sup class="fnref"><a href="#fn-1" id="fnref-1">1</a></sup>');
    expect(ch.html).not.toContain("distinguishes here between");
  });

  it("keeps a greeting before the first numbered paragraph", () => {
    const ch = chapter("lecture-chapter-sol");
    expect(ch.html).toMatch(/^<p>My dear friends!<\/p>/);
    expect(ch.translator).toBe("Steiner Online Library");
    expect(ch.tocUrl).toBe("https://rsarchive.org/Lectures/GA316/");
  });

  it("reads German pages", () => {
    const ch = chapter("lecture-chapter-german");
    expect(ch).toMatchObject({ title: "Weihnachtskurs I", date: "1924-01-02", place: "Dornach", translator: undefined });
    expect(ch.html).toMatch(/^<p>Meine lieben Freunde!<\/p>/);
  });

  it("collects images as figures with absolute URLs and real alt text", () => {
    const ch = chapter("lecture-chapter-images");
    expect(ch.images).toEqual([
      "https://rsarchive.org/Lectures/GA233/English/RSP1977/images/19231224d01_01.gif",
      "https://rsarchive.org/Lectures/GA233/German/images/233-01t.webp",
      "https://rsarchive.org/Lectures/GA233/German/images/233-02t.webp",
    ]);
    expect(ch.html).toContain(`<figure><img src="https://rsarchive.org/Lectures/GA233/English/RSP1977/images/19231224d01_01.gif" alt="Earth's atmosphere turning towards the Sun"/></figure>`);
  });

  it("drops the site's placeholder alt text and links around images", () => {
    const html = `<div id="centerPanel"><div class="articleBox"><h2>T<br><small>GA 1</small></h2><div class="contentBegins"><h3>One</h3>
      <p>Text <a href="/x/big.webp"><img src="/x/small.webp" alt="AltName"></a> <font size="-1">A.D.</font> <a href="javascript:alert(1)">x</a></p></div></div></div>`;
    const ch = parseChapter(html, "https://rsarchive.org/Lectures/GA001/English/X/one.html");
    expect(ch.html).toBe(`<p>Text <img src="https://rsarchive.org/x/small.webp" alt=""/> A.D. x</p>`);
  });
});
