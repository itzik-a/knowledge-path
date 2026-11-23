/* Private notes: the encrypted block (Meld Encrypt's inline v3 format) and whole files in and out. */
import { describe, expect, it } from "vitest";
import { decryptText, encryptText, isLockedName, isPrivate, lockedNameFor, newLockedName, withTitle, isSealed, isSealedSketch, makeCodec, openFile, openSketch, sealedPayload, sealFile, sealSketch } from "../shared/private.ts";
import { INK, parseSketch, serializeSketch } from "../shared/sketch.ts";

const note = "---\nprivate: true\ncreated: 2026-11-23\n---\n# שלום and hello\n\n[[Stoicism]] #secret\n";

describe("the encrypted block", () => {
  it("round-trips any text, and a wrong passphrase or a changed byte opens nothing", async () => {
    const text = "Line one\n\nעברית and English 🎹\n";
    const enc = await encryptText(text, "correct horse");
    expect(await decryptText(enc, "correct horse")).toBe(text);
    expect(await decryptText(enc, "wrong horse")).toBeNull();
    const bytes = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
    bytes[40] ^= 1;
    expect(await decryptText(btoa(String.fromCharCode(...bytes)), "correct horse")).toBeNull();
    expect(await decryptText("not base64!", "correct horse")).toBeNull();
  });

  it("is laid out the way Meld Encrypt reads it: suite 1, 220,000 iterations, salt, IV, ciphertext + tag", async () => {
    const enc = await encryptText("", "pw");
    const bytes = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
    expect(enc).toHaveLength(64); // an empty text is 48 bytes, as the spec says
    expect(bytes[0]).toBe(1);
    expect(bytes[1] * 65536 + bytes[2] * 256 + bytes[3]).toBe(220_000);
    // a fresh IV every time
    expect(await encryptText("same", "pw")).not.toBe(await encryptText("same", "pw"));
  });

  it("recognises both of Meld's markers, with or without a hint", () => {
    expect(sealedPayload("%%🔐γ QUJD 🔐%%\n")).toBe("QUJD");
    expect(sealedPayload("🔐γ 💡my hint💡QUJD 🔐")).toBe("QUJD");
    expect(sealedPayload("Some text\n%%🔐γ QUJD 🔐%%\n")).toBeNull(); // only a body that is one block
    expect(sealedPayload("%%🔐β QUJD 🔐%%")).toBeNull(); // older formats: left alone
  });
});

describe("whole files", () => {
  it("encrypt a private note's body, keep its frontmatter, and open back to the same text", async () => {
    const sealed = await sealFile(note, "pw-12345");
    expect(sealed.startsWith("---\nprivate: true\ncreated: 2026-11-23\n---\n%%🔐γ ")).toBe(true);
    expect(sealed).not.toMatch(/Stoicism|secret|שלום/);
    expect(isSealed(sealed) && isPrivate(sealed)).toBe(true);
    expect(await openFile(sealed, "pw-12345")).toBe(note);
    expect(await openFile(sealed, "other")).toBeNull();
    expect(await sealFile(sealed, "pw-12345")).toBe(sealed); // already encrypted: as it is
  });
  it("leave everything else alone", async () => {
    const plain = "---\ntopics: [x]\n---\nOpen note\n";
    expect(await sealFile(plain, "pw")).toBe(plain);
    expect(await openFile(plain, "pw")).toBe(plain);
    expect(isPrivate("---\nprivate: yes\n---\nx")).toBe(false); // only a real true
  });
});

describe("sketches in locked notes", () => {
  const svg = serializeSketch({ width: 1000, height: 900, strokes: [{ d: "M10,10 Q20,20 30,30 T40,40 Z", fill: INK }] });
  it("become a 'Locked sketch' picture with the drawing encrypted inside, always the same size", async () => {
    const sealed = await sealSketch(svg, "pw-12345");
    expect(isSealedSketch(sealed)).toBe(true);
    expect(sealed).not.toContain("M10,10");
    expect(sealed).toContain('viewBox="0 0 1000 240"');
    expect(sealed).toContain("Locked sketch");
    expect(parseSketch(sealed)).toBeNull(); // not a drawing the sheet would edit
    expect(sealed.match(/<!--([^]*?)-->/)![1]).not.toContain("--");
    expect(await openSketch(sealed, "pw-12345")).toBe(svg);
    expect(await openSketch(sealed, "nope")).toBeNull();
    expect(await sealSketch(sealed, "pw-12345")).toBe(sealed);
  });
  it("the codec encrypts only the sketches it's told are locked, and holds them back without a passphrase", async () => {
    const p = "Sketches/Sketch 1.svg";
    const c = makeCodec(() => "pw-12345", (x) => x === p);
    const out = (await c.seal(p, svg))!;
    expect(isSealedSketch(out)).toBe(true);
    expect(await c.open(p, out)).toBe(svg);
    expect(await c.seal("Sketches/Other.svg", svg)).toBe(svg);
    expect(await makeCodec(() => "", () => true).seal(p, svg)).toBeNull();
    expect(await makeCodec(() => "", () => true).open(p, out)).toBe(out); // can't open: stays as it is
  });
});

describe("hidden titles", () => {
  const locked = withTitle('---\ntopics: ["[[Piano]]"]\nprivate: true\n---\nThe text\n', 'Japanese "piano" pieces, שיר');
  it("the title is the first frontmatter line here, and inside the encrypted block in the vault", async () => {
    expect(locked.startsWith('---\ntitle: "Japanese \\"piano\\" pieces, שיר"\ntopics:')).toBe(true);
    const { parseDoc } = await import("../shared/index.ts");
    expect(parseDoc("Notes/Locked 0a1b2c3d.md", locked).title).toBe('Japanese "piano" pieces, שיר');
    const sealed = await sealFile(locked, "pw-12345");
    expect(sealed).not.toMatch(/title|Japanese|piano|שיר/);
    expect(sealed.startsWith('---\ntopics: ["[[Piano]]"]\nprivate: true\n---\n%%🔐γ ')).toBe(true);
    expect(await openFile(sealed, "pw-12345")).toBe(locked); // exactly as it was
    // without the passphrase: a neutral name and "Locked note"
    expect(parseDoc("Notes/Locked 0a1b2c3d.md", sealed)).toMatchObject({ title: "Locked note", sealed: true });
  });
  it("removes a title, and leaves a note with no frontmatter alone", () => {
    expect(withTitle(locked, undefined)).toBe('---\ntopics: ["[[Piano]]"]\nprivate: true\n---\nThe text\n');
    expect(withTitle("Just text\n", undefined)).toBe("Just text\n");
    expect(withTitle("Just text\n", "T")).toBe('---\ntitle: "T"\n---\nJust text\n');
  });
  it("neutral names: random for a new note; for an existing one the same on every device, but only with the passphrase", async () => {
    expect(isLockedName(newLockedName())).toBe(true);
    expect(isLockedName("Locked notes about piano")).toBe(false);
    const a = await lockedNameFor("Notes/Japanese piano pieces.md", "pw-12345");
    expect(isLockedName(a)).toBe(true);
    expect(await lockedNameFor("Notes/Japanese piano pieces.md", "pw-12345")).toBe(a);
    expect(await lockedNameFor("Notes/Japanese piano pieces.md", "other")).not.toBe(a);
  });
  it("a title typed on a device that can't encrypt it is held back", async () => {
    const sealed = await sealFile(locked, "pw-12345");
    const c = makeCodec(() => "");
    expect(await c.seal("Notes/Locked 0a1b2c3d.md", sealed)).toBe(sealed);
    expect(await c.seal("Notes/Locked 0a1b2c3d.md", withTitle(sealed, "Oops"))).toBeNull();
  });
});
