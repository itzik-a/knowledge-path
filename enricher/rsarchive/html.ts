/* DOM parsing (linkedom) and the cleaner: page markup → "clean HTML", a small subset that is also
   well-formed XHTML (void tags closed, text and attributes escaped). Only known tags and attributes
   survive; scripts, buttons and styles go; <font> and other wrappers are unwrapped; URLs are made
   absolute. The few classes and ids the writers rely on (pn, fnref, p-N, fn-K) are kept. */
import { parseHTML } from "linkedom";

export function parseDoc(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

/** Text of a node with whitespace collapsed. */
export const text = (n: Node | null | undefined) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();

const KEEP = new Set([
  "p", "br", "hr", "i", "em", "b", "strong", "u", "s", "sup", "sub", "small", "cite", "q", "abbr", "code", "pre",
  "blockquote", "ul", "ol", "li", "dl", "dt", "dd", "table", "caption", "thead", "tbody", "tfoot", "tr", "td", "th",
  "h1", "h2", "h3", "h4", "h5", "h6", "div", "figure", "figcaption", "img", "a", "span",
]);
const RENAME: Record<string, string> = { center: "div", strike: "s", tt: "code", big: "span" };
const DROP = new Set([
  "script", "style", "button", "form", "input", "select", "textarea", "iframe", "noscript", "nav", "svg",
  "video", "audio", "object", "embed", "link", "meta", "head", "title", "template",
]);
const VOID = new Set(["br", "hr", "img"]);
const BLOCK = new Set(["p", "div", "blockquote", "ul", "ol", "li", "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "figure", "hr", "dl", "pre"]);
const CLASSES = new Set(["pn", "fnref", "center", "right"]);
const ID = /^(p|fn|fnref)-[\w.-]+$/;
const JUNK_ALT = /^(altname|image|img|picture|\s*)$/i;

export interface CleanOptions {
  /** The page's URL, to make links and images absolute. */
  base: string;
  /** Called with each image's absolute URL, in order. */
  onImage?: (url: string) => void;
}

export function absolute(href: string, base: string): string | null {
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Clean HTML of an element's children. */
export function cleanChildren(el: Node, opts: CleanOptions): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) out += cleanNode(child, opts);
  return out;
}

function alignClass(el: Element): string | null {
  const a = (el.getAttribute("align") ?? "") + " " + (/text-align\s*:\s*(\w+)/i.exec(el.getAttribute("style") ?? "")?.[1] ?? "");
  if (/center/i.test(a)) return "center";
  if (/right/i.test(a)) return "right";
  return null;
}

export function cleanNode(node: Node, opts: CleanOptions): string {
  if (node.nodeType === 3) return esc((node.nodeValue ?? "").replace(/\s+/g, " "));
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  let tag = el.tagName.toLowerCase();
  if (DROP.has(tag)) return "";
  tag = RENAME[tag] ?? tag;
  if (!KEEP.has(tag)) return cleanChildren(el, opts);

  const attrs: [string, string][] = [];
  const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => CLASSES.has(c));
  const align = alignClass(el);
  if (align && !classes.includes(align)) classes.push(align);
  const rawId = el.getAttribute("id");
  const id = rawId && ID.test(rawId) ? rawId : null;
  if (tag === "span" && !classes.length && !id) return cleanChildren(el, opts);

  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    if (/^#fn(ref)?-/.test(href)) attrs.push(["href", href]);
    else {
      const abs = href.startsWith("#") ? null : absolute(href, opts.base);
      // A link to an image (the picture it wraps, full size) adds nothing in a book.
      if (!abs || /\.(png|jpe?g|gif|webp|svg)$/i.test(new URL(abs).pathname)) return cleanChildren(el, opts);
      attrs.push(["href", abs]);
    }
  } else if (tag === "img") {
    const src = absolute(el.getAttribute("src") || el.getAttribute("data-src") || "", opts.base);
    if (!src) return "";
    opts.onImage?.(src);
    const alt = el.getAttribute("alt") ?? "";
    attrs.push(["src", src], ["alt", JUNK_ALT.test(alt) ? "" : alt.trim()]);
  } else if (tag === "td" || tag === "th") {
    for (const k of ["colspan", "rowspan"]) {
      const v = el.getAttribute(k);
      if (v && /^\d+$/.test(v)) attrs.push([k, v]);
    }
  } else if (tag === "ol") {
    const start = el.getAttribute("start");
    if (start && /^\d+$/.test(start)) attrs.push(["start", start]);
    const type = el.getAttribute("type");
    if (type && /^[1aAiI]$/.test(type)) attrs.push(["type", type]);
  }
  // Fixed order (…, id, class): the writers match these attributes as text.
  if (id) attrs.push(["id", id]);
  if (classes.length) attrs.push(["class", classes.join(" ")]);
  const open = `<${tag}${attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("")}`;
  if (VOID.has(tag)) return `${open}/>`;

  const inner = cleanChildren(el, opts);
  // Drop empty containers (a <p> holding only whitespace or &nbsp;), but keep table cells.
  if (!inner.replace(/[\s ]+/g, "") && tag !== "td" && tag !== "th" && tag !== "span") return "";
  const close = `</${tag}>`;
  return BLOCK.has(tag) ? `${open}>${inner.trim()}${close}\n` : `${open}>${inner}${close}`;
}
