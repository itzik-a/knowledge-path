import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Boundary } from "./components/Boundary";
import { trackHistory } from "./lib/route";
import { init } from "./state/store";
import { startSync } from "./state/sync";
import { migrateLocked } from "./state/privacy";
import { startAppearance } from "./state/appearance";
import { startAsks } from "./state/ask";
import "./lib/theme";
import "./lib/reading";
import "./styles.css";
import { startPdfs } from "./state/pdfs";

trackHistory();
void init().then(async () => { startAppearance(); startAsks(); try { await migrateLocked(); } catch (e) { console.error(e); } startSync(); startPdfs(); });
// Fetch the editor's, cook mode's, the session timer's and the drawing sheet's code once the app is idle, so they
// work offline from the first launch and still open in an app left running across a deploy (src/lib/lazy.ts).
// The PDF reader (pdf.js, large) loads when it's needed.
setTimeout(() => {
  for (const load of [() => import("./components/Editor"), () => import("./components/CookMode"), () => import("./components/SitMode"), () => import("./components/SketchSheet")]) {
    void load().catch(() => { /* offline, or a newer version is out: loaded when opened */ });
  }
}, 4000);

// Offline launch from the Home Screen. Production only, so dev reloads stay fresh.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
