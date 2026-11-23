/* Private notes: the encrypted block (Meld Encrypt's inline v3 format) and whole files in and out. */
import { describe, expect, it } from "vitest";
import { decryptText, encryptText, isPrivate, isSealed, openFile, sealedPayload, sealFile } from "../shared/private.ts";

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
