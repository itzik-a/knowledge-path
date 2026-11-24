import { lazy, Suspense, useEffect, useState, type ComponentType, type SVGProps } from "react";
import { inbox } from "../shared/index.ts";
import { kindOf } from "../shared/vault.ts";
import { topicColor } from "./components/bits";
import { CaptureSheet } from "./components/CaptureSheet";
import { ConfirmDialog } from "./components/Confirm";
import { DataPill, DataSheet } from "./components/DataSheet";
import { HabitSheet } from "./components/HabitSheet";
import { IconCart, IconHabit, IconRecipe, IconHome, IconInbox, IconLibrary, IconNotes, IconPlus, IconSearch, IconTopics } from "./components/Icons";
import { SearchDialog } from "./components/SearchDialog";
import { Toast } from "./components/Toast";

// the drawing sheet loads the first time a sketch is opened
const SketchSheet = lazy(() => import("./components/SketchSheet").then((m) => ({ default: m.SketchSheet })));
const CookMode = lazy(() => import("./components/CookMode").then((m) => ({ default: m.CookMode })));
const TimerDock = lazy(() => import("./components/CookMode").then((m) => ({ default: m.TimerDock })));
const SitMode = lazy(() => import("./components/SitMode").then((m) => ({ default: m.SitMode })));
const SitDock = lazy(() => import("./components/SitMode").then((m) => ({ default: m.SitDock })));
import { TopicSheet } from "./components/TopicSheet";
import { readHash, topicHref, type Route } from "./lib/route";
import { PrivateSheet } from "./components/PrivateNotes";
import { closeSheetReq, openSheet, useSheet } from "./lib/sheets";
import { useTimers } from "./lib/timers";
import { useSit } from "./state/sit";
import { useVault } from "./state/store";
import { syncNow } from "./state/sync";
import { DocPage } from "./views/DocPage";
import { Habits } from "./views/Habits";
import { Home } from "./views/Home";
import { Inbox } from "./views/Inbox";
import { Library } from "./views/Library";
import { Recipes } from "./views/Recipes";
import { Shopping, shoppingLeft } from "./views/Shopping";
import { ShoppingSheet } from "./components/ShoppingSheet";
import { SHOPPING_PATH } from "../shared/shopping.ts";
import { Notes, TagPage } from "./views/Notes";
import { Topics } from "./views/Topics";

type Tab = "home" | "topics" | "library" | "notes";
const TABS: { id: Tab; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { id: "home", label: "Home", Icon: IconHome },
  { id: "topics", label: "Topics", Icon: IconTopics },
  { id: "library", label: "Library", Icon: IconLibrary },
  { id: "notes", label: "Notes", Icon: IconNotes },
];

/** Which tab a route belongs to. */
function tabOf(r: Route): Tab {
  if (r.view === "doc" && r.sub) {
    const k = kindOf(r.sub);
    return k === "resource" || k === "chapter" ? "library" : k === "path" ? "topics" : k === "habit" || k === "recipe" ? "home" : "notes";
  }
  if (r.view === "tag") return "notes";
  if (r.view === "inbox") return "library";
  return r.view === "capture" || r.view === "habits" || r.view === "recipes" || r.view === "shopping" ? "home" : (r.view as Tab);
}

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function App() {
  const [route, setRoute] = useState<Route>(readHash);
  const { ready, index: ix } = useVault();
  const sheet = useSheet();
  const hasTimers = useTimers().length > 0;
  // a session timer (its clock runs from src/state/sit.ts, loaded here, even with its screen closed)
  const hasSit = !!useSit();

  useEffect(() => {
    const on = () => setRoute((prev) => {
      const next = readHash();
      if (next.view !== prev.view || next.sub !== prev.sub) window.scrollTo(0, 0);
      return next;
    });
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  // #capture?url=…&title=…&text=… from the bookmarklet or a shared link
  useEffect(() => {
    if (route.view !== "capture" || !ready) return;
    const p = route.params;
    openSheet({ kind: "capture", init: { url: p.get("url") ?? undefined, title: p.get("title") ?? undefined, text: p.get("text") ?? undefined } });
    history.replaceState(history.state, "", "#inbox");
    setRoute(readHash());
  }, [route, ready]);

  // ⌘K search, N new
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSheet({ kind: "search" }); return; }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
      if (e.key === "n") { e.preventDefault(); openSheet({ kind: "capture", init: {} }); }
      else if (e.key === "/") { e.preventDefault(); openSheet({ kind: "search" }); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const tab = tabOf(route);
  /** the sidebar marks Habits, Recipes and the Inbox on their own, not the tab they belong to */
  const habitsOpen = route.view === "habits" || (route.view === "doc" && !!route.sub && kindOf(route.sub) === "habit");
  const recipesOpen = route.view === "recipes" || (route.view === "doc" && !!route.sub && kindOf(route.sub) === "recipe");
  const toBuy = ready ? shoppingLeft(ix.docs.get(SHOPPING_PATH)?.body) : 0;
  const waiting = ready ? inbox(ix).length : 0;
  const top = ix.topicOrder.map((id) => ix.topics.get(id)!).filter((t) => !t.parent);
  const onCaptureClose = () => {
    closeSheetReq();
    // opened by the bookmarklet in its own little window: send it and close
    if (window.name === "kp" && window.opener) void syncNow().finally(() => window.close());
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Knowledge Path, home">
          <img src="./icon.svg" alt="" width={30} height={30} />
          <span>Knowledge Path</span>
        </a>
        <div className="side-actions">
          <button type="button" className="btn primary sm grow" onClick={() => openSheet({ kind: "capture", init: {} })}><IconPlus /> Add</button>
          <button type="button" className="icon-btn" onClick={() => openSheet({ kind: "search" })} aria-label="Search (⌘K)" title="Search (⌘K)"><IconSearch /></button>
        </div>
        <nav className="side-nav" aria-label="Sections">
          {TABS.map(({ id, label, Icon }) => (
            <a key={id} href={`#${id}`} aria-current={tab === id && route.view !== "inbox" && route.view !== "shopping" && !habitsOpen && !recipesOpen ? "page" : undefined}><Icon /><span>{label}</span></a>
          ))}
          <a href="#habits" aria-current={habitsOpen ? "page" : undefined}><IconHabit /><span>Habits</span></a>
          <a href="#recipes" aria-current={recipesOpen ? "page" : undefined}><IconRecipe /><span>Recipes</span></a>
          <a href="#shopping" aria-current={route.view === "shopping" ? "page" : undefined}><IconCart /><span>Shopping list</span>{toBuy > 0 && <span className="badge">{toBuy}</span>}</a>
          <a href="#inbox" aria-current={route.view === "inbox" ? "page" : undefined}><IconInbox /><span>Inbox</span>{waiting > 0 && <span className="badge">{waiting}</span>}</a>
        </nav>
        <nav className="side-topics" aria-label="Topics">
          <span className="eyebrow">Topics</span>
          {top.map((t) => (
            <a key={t.id} href={topicHref(t.id)} aria-current={route.view === "topics" && (route.sub === t.id || route.sub?.startsWith(t.id + "/")) ? "page" : undefined}>
              <span className="swatch sm" style={{ background: topicColor(t) }} /><span dir="auto">{t.name}</span>
            </a>
          ))}
        </nav>
        <div className="side-foot"><DataPill onOpen={() => openSheet({ kind: "data" })} /></div>
      </aside>

      <header className="topbar">
        <a className="brand" href="#home" aria-label="Knowledge Path, home">
          <img src="./icon.svg" alt="" width={28} height={28} />
          <span>Knowledge</span>
        </a>
        <div className="top-actions">
          <DataPill onOpen={() => openSheet({ kind: "data" })} />
          <button type="button" className="icon-btn subtle" onClick={() => openSheet({ kind: "search" })} aria-label="Search"><IconSearch width={20} height={20} /></button>
        </div>
      </header>

      <main className={`main view-${route.view}`} key={`${route.view}/${route.sub ?? ""}`}>
        {!ready ? null
          : route.view === "topics" ? <Topics sub={route.sub} />
          : route.view === "library" ? <Library />
          : route.view === "notes" ? <Notes sub={route.sub} />
          : route.view === "inbox" ? <Inbox />
          : route.view === "habits" ? <Habits />
          : route.view === "recipes" ? <Recipes />
          : route.view === "shopping" ? <Shopping />
          : route.view === "tag" && route.sub ? <TagPage tag={route.sub} />
          : route.view === "doc" && route.sub ? <DocPage path={route.sub} />
          : <Home />}
      </main>

      <button type="button" className="fab" onClick={() => openSheet({ kind: "capture", init: {} })} aria-label="Add a link or note"><IconPlus width={22} height={22} /></button>

      <Toast />
      <ConfirmDialog />
      {sheet?.kind === "capture" && <CaptureSheet init={sheet.init} onClose={onCaptureClose} />}
      {sheet?.kind === "topic" && <TopicSheet id={sheet.id} parent={sheet.parent} onClose={closeSheetReq} />}
      {sheet?.kind === "habit" && <HabitSheet key={sheet.path ?? "new"} path={sheet.path} topics={sheet.topics} onClose={closeSheetReq} />}
      {sheet?.kind === "search" && <SearchDialog onClose={closeSheetReq} />}
      {sheet?.kind === "data" && <DataSheet onClose={closeSheetReq} />}
      {sheet?.kind === "private" && <PrivateSheet then={sheet.then} onClose={closeSheetReq} />}
      {sheet?.kind === "shop" && <ShoppingSheet key={sheet.path} path={sheet.path} onClose={closeSheetReq} />}
      {sheet?.kind === "cook" && <Suspense fallback={null}><CookMode key={sheet.path} path={sheet.path} onClose={closeSheetReq} /></Suspense>}
      {sheet?.kind === "sit" && <Suspense fallback={null}><SitMode key={sheet.path} path={sheet.path} onClose={closeSheetReq} /></Suspense>}
      {sheet?.kind !== "sit" && hasSit && <Suspense fallback={null}><SitDock onOpen={(path) => openSheet({ kind: "sit", path })} /></Suspense>}
      {sheet?.kind !== "cook" && !hasSit && hasTimers && <Suspense fallback={null}><TimerDock onOpen={(path) => openSheet({ kind: "cook", path })} /></Suspense>}
      {sheet?.kind === "sketch" && <Suspense fallback={null}><SketchSheet key={sheet.path ?? "new"} path={sheet.path} note={sheet.note} onClose={closeSheetReq} /></Suspense>}

      <nav className="tabbar" aria-label="Sections">
        {TABS.map(({ id, label, Icon }) => (
          <a key={id} href={`#${id}`} aria-current={tab === id ? "page" : undefined}><Icon /><span>{label}</span></a>
        ))}
      </nav>
    </div>
  );
}
