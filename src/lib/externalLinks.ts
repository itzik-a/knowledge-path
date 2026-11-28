/* Links to other sites, in the installed apps.

   - The Mac web app (Safari's "Add to Dock"): since macOS Sequoia, Safari keeps every link inside the web app: with
     target="_blank" another web-app window, in place (by script or by the user's own click, both tried) the same
     window, with a swipe to get back. No manifest scope or setting changes that. So outside links go to Chrome
     (the default browser) through the scheme Chrome registers on the Mac, google-chrome://<url> (Chrome strips the
     prefix and opens the page in a new tab; Safari asks before opening another app, so there's no fallback timer:
     it could fire while the prompt is up and open the page twice). Only in Safari's web app: an app
     installed from Chrome already opens target="_blank" links in a Chrome tab, so it's left alone.
   - The iPhone and iPad Home Screen apps: iOS opens links in Safari's in-app viewer and a web page can't ask for the
     default browser, so links open in Chrome (googlechromes://); if Chrome hasn't taken over 1.5 s later (not
     installed, or the prompt was cancelled), the link opens as before.
   - A browser tab: links keep target="_blank". */

/** True when `href` points at a web page outside this app (another origin, http or https). */
export function isExternal(href: string, base: string): boolean {
  let url: URL;
  try { url = new URL(href, base); } catch { return false; }
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== new URL(base).origin;
}

/** The same page in Chrome on the Mac: Chrome's own scheme in front of the whole address. */
export const macChromeUrl = (href: string) => `google-chrome://${href}`;

/** The same page in Chrome on iOS: googlechromes:// for https, googlechrome:// for http. */
export function chromeUrl(href: string): string {
  return href.replace(/^https:\/\//i, "googlechromes://").replace(/^http:\/\//i, "googlechrome://");
}

const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
/** On a Mac without touch (an iPad reports itself as a Mac, but with touch points). */
const isMac = () => /Mac/.test(navigator.platform) && navigator.maxTouchPoints === 0;
/** Safari itself (an app installed from Chrome or Edge reports Chrome in its user agent). */
const isSafari = () => /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(navigator.userAgent);
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.platform) || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);

function externalLink(e: MouseEvent): HTMLAnchorElement | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement) || a.hasAttribute("download")) return null;
  return isExternal(a.href, location.href) ? a : null;
}

export function startExternalLinks(): void {
  if (!standalone()) return;
  if (isMac()) {
    if (!isSafari()) return;
    window.addEventListener("click", (e) => {
      const a = externalLink(e);
      if (!a) return;
      e.preventDefault();
      const href = a.href;
      // no fallback timer here: Safari's "open Google Chrome?" prompt can stay up longer than any timer
      location.href = macChromeUrl(href);
    }, true);
  } else if (isIOS()) {
    window.addEventListener("click", (e) => {
      const a = externalLink(e);
      if (!a) return;
      e.preventDefault();
      const href = a.href;
      location.href = chromeUrl(href);
      const fallback = window.setTimeout(() => { if (document.visibilityState === "visible") window.open(href, "_blank", "noopener"); }, 1500);
      document.addEventListener("visibilitychange", () => clearTimeout(fallback), { once: true });
    }, true);
  }
}
