import { describe, expect, it } from "vitest";
import { cleanSelection, pageLink, pageOf, pdfOf, pdfPathFor, piecesFor, rangesFor } from "../shared/pdfs.ts";

describe("pdfs", () => {
  it("reads a resource's PDF link", () => {
    expect(pdfOf({ pdf: "[[PDFs/On Liberty.pdf]]" })).toBe("PDFs/On Liberty.pdf");
    expect(pdfOf({ pdf: "PDFs/x.pdf" })).toBe("PDFs/x.pdf");
    expect(pdfOf({ pdf: "[[Notes/x.md]]" })).toBeUndefined();
    expect(pdfOf({})).toBeUndefined();
  });
  it("names new PDFs safely and uniquely", () => {
    const taken = new Set(["PDFs/On Liberty.pdf"]);
    expect(pdfPathFor("On Liberty.pdf", (p) => taken.has(p))).toBe("PDFs/On Liberty 2.pdf");
    expect(pdfPathFor("a/b: c?", () => false)).toBe("PDFs/a b c.pdf");
  });
  it("links highlights to their page and reads the page back", () => {
    const c = pageLink("PDFs/x.pdf", 12);
    expect(c).toBe("[[PDFs/x.pdf#page=12|p. 12]]");
    expect(pageOf(c)).toBe(12);
    expect(pageOf("no page")).toBeUndefined();
  });
  it("tidies a selection", () => {
    expect(cleanSelection("the indi-\nvidual is   sovereign\nover himself")).toBe("the individual is sovereign over himself");
    expect(cleanSelection("well-\nKnown")).toBe("well- Known");
  });
  it("finds the text pieces a highlight covers", () => {
    const pieces = ["Over himself, over his", " own body and mind, ", "the individual is sove", "reign. Next sentence."];
    expect(piecesFor(pieces, "body and mind, the individual is sovereign")).toEqual([1, 2, 3]);
    expect(piecesFor(pieces, "not on this page")).toEqual([]);
    expect(piecesFor(pieces, "the ==individual== is")).toEqual([2]);
  });
  it("marks only the quoted characters of a piece", () => {
    const pieces = ["individual. Over himself, over his own body and mind,", "the individual is sovereign."];
    expect(rangesFor(pieces, "Over himself, over his own body and mind, the individual is sovereign")).toEqual([
      { i: 0, from: 12, to: 53 }, { i: 1, from: 0, to: 27 },
    ]);
  });
});
