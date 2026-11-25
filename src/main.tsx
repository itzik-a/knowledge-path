import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { trackHistory } from "./lib/route";
import { init } from "./state/store";
import { startSync } from "./state/sync";
import { migrateLocked } from "./state/privacy";
import { startAppearance } from "./state/appearance";
import "./lib/theme";
import "./styles.css";

trackHistory();
void init().then(async () => { startAppearance(); try { await migrateLocked(); } catch (e) { console.error(e); } startSync(); });
// Fetch the editor's code once the app is idle, so editing works offline from the first launch.
setTimeout(() => { void import("./components/Editor"); }, 4000);

// Offline launch from the Home Screen. Production only, so dev reloads stay fresh.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
