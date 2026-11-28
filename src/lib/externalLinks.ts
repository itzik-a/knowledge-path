/* Links to other sites, in the installed apps.

   - The Mac web app (Safari's "Add to Dock"): a link with target="_blank" opens another web-app window, and a
     navigation started from script (location.assign) stays inside the app too. A link the user clicks that leaves
     the app's scope in the same window is what Safari hands to the default browser (Chrome). So the click is caught
     first (capture phase on window, before any of the app's own handlers), the link's target is dropped, and the
     click goes on as the user's own.
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

/** The same page in Chrome on iOS: googlechromes:// for https, googlechrome:// for http. */
export function chromeUrl(href: string): string {
  return href.replace(/^https:\/\//i, "googlechromes://").replace(/^http:\/\//i, "googlechrome://");
}

const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
/** On a Mac without touch (an iPad reports itself as a Mac, but with touch points). */
const isMac = () => /Mac/.test(navigator.platform) && navigator.maxTouchPoints === 0;
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
    window.addEventListener("click", (e) => {
      const a = externalLink(e);
      if (a) a.removeAttribute("target"); // the click itself now leaves the app, and Safari opens the default browser
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
