/* External links in the Mac web app (Safari's "Add to Dock").

   There a link with target="_blank" opens another web-app window instead of the default browser (Chrome). Safari
   hands a navigation outside the app's scope to the default browser, so in that app an external link is followed in
   place instead. Everywhere else (the iPhone and iPad Home Screen apps, a browser tab) links keep target="_blank". */

/** True when `href` points at a web page outside this app (another origin, http or https). */
export function isExternal(href: string, base: string): boolean {
  let url: URL;
  try { url = new URL(href, base); } catch { return false; }
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== new URL(base).origin;
}

/** The app is the Mac's Safari web app: standalone, on a Mac without touch (an iPad reports itself as a Mac). */
function isMacWebApp(): boolean {
  const standalone = matchMedia("(display-mode: standalone)").matches;
  return standalone && /Mac/.test(navigator.platform) && navigator.maxTouchPoints === 0;
}

export function startExternalLinks(): void {
  if (!isMacWebApp()) return;
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as Element | null)?.closest?.("a[href]");
    if (!(a instanceof HTMLAnchorElement) || a.hasAttribute("download")) return;
    if (!isExternal(a.href, location.href)) return;
    e.preventDefault();
    location.assign(a.href);
  });
}
