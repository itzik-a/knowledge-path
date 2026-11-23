/* Private notes: a note with `private: true` in its frontmatter is kept encrypted in the vault. Its
   frontmatter stays readable (so the file name, topics and dates still work); its body is replaced by
   one encrypted block in the Meld Encrypt plugin's format (inline "gamma", format v3), so Obsidian with
   that plugin decrypts it with the same passphrase, and Obsidian without it hides the block (a %% comment):

     ---
     private: true
     topics: ["[[Philosophy]]"]
     ---
     %%🔐γ <base64> 🔐%%

   The base64 is: 1 byte suite (1) · 3 bytes PBKDF2 iterations (big-endian) · 16 bytes salt · 12 bytes IV ·
   the AES-256-GCM ciphertext and its 16-byte tag. The key is PBKDF2-HMAC-SHA512 of the passphrase and
   salt; the additional authenticated data is JSON.stringify({ version, kdf, cipher }) in that key order.
   Spec: github.com/meld-cp/obsidian-encrypt, docs/dev-notes.md, "Encryption format v3".

   Encryption happens only on the way into the vault and decryption on the way out (the sync does both),
   so on a device with the passphrase a private note is an ordinary note. No DOM or Node APIs: Web Crypto
   is in browsers and Node alike. */
import { splitFrontmatter } from "./vault.ts";

const ITERATIONS = 220_000;
const MIN_ITER = 220_000, MAX_ITER = 2_000_000;
const SEALED_RE = /^\s*(?:%%)?🔐γ (?:💡[^]*?💡)?([A-Za-z0-9+/]+={0,2}) 🔐(?:%%)?\s*$/u;

export const isPrivate = (text: string) => splitFrontmatter(text).fm.private === true;

/** The base64 payload when a body is one encrypted block, else null. */
export function sealedPayload(body: string): string | null {
  return SEALED_RE.exec(body)?.[1] ?? null;
}

/** A file whose body is encrypted (as it is in the vault, or here without the passphrase). */
export const isSealed = (text: string) => sealedPayload(splitFrontmatter(text).body) != null;

/** The file up to and including its frontmatter, and its body. */
function parts(text: string): [string, string] {
  const { body } = splitFrontmatter(text);
  return [text.slice(0, text.length - body.length), body];
}

// ── the crypto ────────────────────────────────────────────────

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function aad(iterations: number, salt: Uint8Array, iv: Uint8Array): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    version: "3.0",
    kdf: { name: "PBKDF2", hash: "SHA-512", iterations, salt: b64(salt) },
    cipher: { name: "AES-GCM", keyLength: 256, iv: b64(iv), tagLength: 128 },
  }));
}

// Deriving a key is slow on purpose (~0.1 s on a phone), so keys are kept for the session. Every file this
// device encrypts in a session shares one salt (each still gets its own random IV).
const keys = new Map<string, Promise<CryptoKey>>();
function keyFor(pass: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const id = `${iterations}:${b64(salt)}:${pass}`;
  let k = keys.get(id);
  if (!k) {
    k = crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]).then((m) =>
      crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-512", salt: salt as BufferSource, iterations }, m, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
    keys.set(id, k);
  }
  return k;
}
let sessionSalt: { pass: string; salt: Uint8Array } | null = null;

/** Forget the keys worked out this session (the passphrase changed or was removed). */
export function forgetKeys() { keys.clear(); sessionSalt = null; }

export async function encryptText(plain: string, pass: string): Promise<string> {
  if (sessionSalt?.pass !== pass) sessionSalt = { pass, salt: crypto.getRandomValues(new Uint8Array(16)) };
  const { salt } = sessionSalt;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(pass, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, tagLength: 128, additionalData: aad(ITERATIONS, salt, iv) as BufferSource }, key, new TextEncoder().encode(plain)));
  const out = new Uint8Array(32 + ct.length);
  out[0] = 1;
  out[1] = ITERATIONS >>> 16; out[2] = (ITERATIONS >>> 8) & 255; out[3] = ITERATIONS & 255;
  out.set(salt, 4); out.set(iv, 20); out.set(ct, 32);
  return b64(out);
}

/** The text, or null when the passphrase is wrong or the block is damaged. */
export async function decryptText(payload: string, pass: string): Promise<string | null> {
  try {
    const bytes = unb64(payload);
    if (bytes.length < 48 || bytes[0] !== 1) return null;
    const iterations = bytes[1] * 65536 + bytes[2] * 256 + bytes[3];
    if (iterations < MIN_ITER || iterations > MAX_ITER) return null;
    const salt = bytes.slice(4, 20), iv = bytes.slice(20, 32);
    const key = await keyFor(pass, salt, iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource, tagLength: 128, additionalData: aad(iterations, salt, iv) as BufferSource }, key, bytes.slice(32) as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ── whole files ───────────────────────────────────────────────

/** A file as it goes into the vault: a private note's body encrypted; anything else as it is. */
export async function sealFile(text: string, pass: string): Promise<string> {
  if (!isPrivate(text)) return text;
  const [head, body] = parts(text);
  if (sealedPayload(body) != null) return text; // already encrypted (this device couldn't read it)
  return `${head}%%🔐γ ${await encryptText(body, pass)} 🔐%%\n`;
}

/** A file as it comes out of the vault: an encrypted body decrypted. Null when the passphrase doesn't open it. */
export async function openFile(text: string, pass: string): Promise<string | null> {
  const [head, body] = parts(text);
  const payload = sealedPayload(body);
  if (payload == null) return text;
  const plain = await decryptText(payload, pass);
  return plain == null ? null : head + plain;
}

/** The sync's codec (src/lib/vaultsync.ts `Codec`), with this device's passphrase ("" when it has none). */
export function makeCodec(passphrase: () => string) {
  return {
    async open(path: string, text: string): Promise<string> {
      const pass = passphrase();
      if (!pass || !path.endsWith(".md") || !isSealed(text)) return text;
      return (await openFile(text, pass)) ?? text;
    },
    async seal(path: string, text: string): Promise<string | null> {
      if (!path.endsWith(".md") || !isPrivate(text) || isSealed(text)) return text;
      const pass = passphrase();
      return pass ? sealFile(text, pass) : null; // never send a private note in the clear
    },
  };
}
