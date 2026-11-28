/* Links to other sites, in the installed apps.

   - The iPhone and iPad Home Screen apps: iOS opens links in Safari's in-app viewer and a web page can't ask for the
     default browser, so links open in Chrome (googlechromes://); if Chrome hasn't taken over 1.5 s later (not
     installed, or the prompt was cancelled), the link opens as before.
   - The Mac: left alone. Since macOS Sequoia Safari's web apps (Add to Dock) keep every link inside the app, and
     nothing a page can do changes that (all tried, 2026-11-28): following the link in place, by script or as the
     user's own click, stays in the window (swipe back); google-chrome://<url> only brings Chrome forward without
     opening the page. target="_blank" at least opens a separate web-app window and leaves the app's page alone. An
     app installed from Chrome (⋮ → Cast, save and share → Install page as app) opens these links in a Chrome tab.
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
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.platform) || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);

function externalLink(e: MouseEvent): HTMLAnchorElement | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement) || a.hasAttribute("download")) return null;
  return isExternal(a.href, location.href) ? a : null;
}

export function startExternalLinks(): void {
  if (!standalone()) return;
  if (isIOS()) {
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
