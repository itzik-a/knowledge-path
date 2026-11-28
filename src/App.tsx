import { Fragment, Suspense, useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { lazyPart, reopenSheet } from "./lib/lazy";
import { Boundary } from "./components/Boundary";
import { inbox, pinnedDocs } from "../shared/index.ts";
import { kindOf } from "../shared/vault.ts";
import { docEmoji, docLabel, topicColor } from "./components/bits";
import { CaptureSheet } from "./components/CaptureSheet";
import { ConfirmDialog } from "./components/Confirm";
import { useLocalState } from "./components/ui";
import { DataPill, DataSheet } from "./components/DataSheet";
import { HabitSheet } from "./components/HabitSheet";
import { TimerStartSheet } from "./components/TimerStartSheet";
import { AskSheet } from "./components/AskSheet";
import { ShortcutsSheet } from "./components/ShortcutsSheet";
import { IconCards, IconCart, IconChevronDown, IconGraph, IconHabit, IconPath, IconRecipe, IconHome, IconInbox, IconLibrary, IconNotes, IconPlus, IconSearch, IconTopics } from "./components/Icons";
import { SearchDialog } from "./components/SearchDialog";
import { Toast } from "./components/Toast";

// loaded on first use (main.tsx fetches the small ones once the app is idle); lazyPart reloads onto a new
// version when an app left open since an older one asks for a file the deploy removed (src/lib/lazy.ts)
const SketchSheet = lazyPart(() => import("./components/SketchSheet").then((m) => ({ default: m.SketchSheet })));
const CookMode = lazyPart(() => import("./components/CookMode").then((m) => ({ default: m.CookMode })));
const TimerDock = lazyPart(() => import("./components/CookMode").then((m) => ({ default: m.TimerDock })));
const SitMode = lazyPart(() => import("./components/SitMode").then((m) => ({ default: m.SitMode })));
const PdfReader = lazyPart(() => import("./components/PdfReader").then((m) => ({ default: m.PdfReader })));
const SitDock = lazyPart(() => import("./components/SitMode").then((m) => ({ default: m.SitDock })));
import { TopicSheet } from "./components/TopicSheet";
import { docHref, readHash, tagHref, topicHref, type Route } from "./lib/route";
import { PrivateSheet } from "./components/PrivateNotes";
import { closeSheetReq, openSheet, useSheet } from "./lib/sheets";
import { useTimers } from "./lib/timers";
import { useSit } from "./state/sit";
import { useVault } from "./state/store";
import { ReadingButton } from "./components/ReadingPanel";
import { iconOf, logoOf, useAccent } from "./state/appearance";
import { usePinnedTags } from "./state/tagpins";
import { syncNow } from "./state/sync";
import { DocPage } from "./views/DocPage";
import { Habits } from "./views/Habits";
import { Home } from "./views/Home";
import { Inbox } from "./views/Inbox";
import { Library } from "./views/Library";
import { Recipes } from "./views/Recipes";
import { Paths } from "./views/Paths";
import { Shopping, shoppingLeft } from "./views/Shopping";
import { ShoppingSheet } from "./components/ShoppingSheet";
import { SHOPPING_PATH } from "../shared/shopping.ts";
import { Notes, TagPage } from "./views/Notes";
import { Review, useDueCount } from "./views/Review";
import { Topics } from "./views/Topics";
import { useWaiting } from "./state/feed";

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
  if (r.view === "paths") return "topics";
  return r.view === "capture" || r.view === "habits" || r.view === "recipes" || r.view === "shopping" || r.view === "review" ? "home" : (r.view as Tab);
}

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function App() {
  const [route, setRoute] = useState<Route>(readHash);
  const { ready, index: ix } = useVault();
  const accent = useAccent();
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

  // after a reload onto a new version (src/lib/lazy.ts): open what was being opened
  useEffect(() => { if (ready) reopenSheet(); }, [ready]);

  // #capture?url=…&title=…&text=… from the bookmarklet or a shared link
  useEffect(() => {
    if (route.view !== "capture" || !ready) return;
    const p = route.params;
    openSheet({ kind: "capture", init: { url: p.get("url") ?? undefined, title: p.get("title") ?? undefined, text: p.get("text") ?? undefined } });
    history.replaceState(history.state, "", "#inbox");
    setRoute(readHash());
  }, [route, ready]);

  // ⌘K search, N new, ? shortcuts
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSheet({ kind: "search" }); return; }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
      if (e.key === "n") { e.preventDefault(); openSheet({ kind: "capture", init: {} }); }
      else if (e.key === "?") { e.preventDefault(); openSheet({ kind: "shortcuts" }); }
      else if (e.key === "/") { e.preventDefault(); openSheet({ kind: "search" }); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const tab = tabOf(route);
  /** the sidebar marks Habits, Recipes and the Inbox on their own, not the tab they belong to */
  const habitsOpen = route.view === "habits" || (route.view === "doc" && !!route.sub && kindOf(route.sub) === "habit");
  const graphOpen = route.view === "notes" && route.sub === "graph";
  const recipesOpen = route.view === "recipes" || (route.view === "doc" && !!route.sub && kindOf(route.sub) === "recipe");
  const pathsOpen = route.view === "paths" || (route.view === "doc" && !!route.sub && kindOf(route.sub) === "path");
  const toBuy = ready ? shoppingLeft(ix.docs.get(SHOPPING_PATH)?.body) : 0;
  const feedWaiting = useWaiting().length;
  const waiting = (ready ? inbox(ix).length : 0) + feedWaiting;
  const dueCards = useDueCount();
  const top = ix.topicOrder.map((id) => ix.topics.get(id)!).filter((t) => !t.parent);
  const pinned = ready ? pinnedDocs(ix) : [];
  const pinnedTags = usePinnedTags();
  // the sections the user folded or unfolded, away from how each starts (More starts folded, the rest open)
  const [sideFlipped, setSideFlipped] = useLocalState<string[]>("knowledgePath.sideFolded", []);
  const sideFold: SideFold = { flipped: sideFlipped, toggle: (id) => setSideFlipped((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]) };
  const onCaptureClose = () => {
    closeSheetReq();
    // opened by the bookmarklet in its own little window: send it and close
    if (window.name === "kp" && window.opener) void syncNow().finally(() => window.close());
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Knowledge Hub, home">
          <img src={logoOf(accent)} alt="" width={30} height={30} />
          <span>Knowledge Hub</span>
        </a>
        <div className="side-actions">
          <button type="button" className="btn primary sm grow" onClick={() => openSheet({ kind: "capture", init: {} })}><IconPlus /> Add</button>
          <button type="button" className="icon-btn" onClick={() => openSheet({ kind: "search" })} aria-label="Search (⌘K)" title="Search (⌘K)"><IconSearch /></button>
          <ReadingButton className="icon-btn" />
        </div>
        <div className="side-scroll">
          <nav className="side-nav" aria-label="Sections">
            {TABS.map(({ id, label, Icon }) => (
              <a key={id} href={`#${id}`} aria-current={tab === id && route.view !== "inbox" && route.view !== "shopping" && !habitsOpen && !recipesOpen && !pathsOpen && !graphOpen && route.view !== "review" ? "page" : undefined}><Icon /><span>{label}</span></a>
            ))}
            <a href="#paths" aria-current={pathsOpen ? "page" : undefined}><IconPath /><span>Study paths</span></a>
            <a href="#inbox" aria-current={route.view === "inbox" ? "page" : undefined}><IconInbox /><span>Inbox</span>{waiting > 0 && <span className="badge">{waiting}</span>}</a>
          </nav>
          <SideSection id="more" title="More" className="side-nav" fold={sideFold} closedFirst
            items={[
              { key: "graph", on: graphOpen, link: <a href="#notes/graph" aria-current={graphOpen ? "page" : undefined}><IconGraph /><span>Graph</span></a> },
              { key: "review", on: route.view === "review", count: dueCards, link: <a href="#review" aria-current={route.view === "review" ? "page" : undefined}><IconCards /><span>Flashcards</span>{dueCards > 0 && <span className="badge">{dueCards}</span>}</a> },
              { key: "habits", on: habitsOpen, link: <a href="#habits" aria-current={habitsOpen ? "page" : undefined}><IconHabit /><span>Habits</span></a> },
              { key: "recipes", on: recipesOpen, link: <a href="#recipes" aria-current={recipesOpen ? "page" : undefined}><IconRecipe /><span>Recipes</span></a> },
              { key: "shopping", on: route.view === "shopping", link: <a href="#shopping" aria-current={route.view === "shopping" ? "page" : undefined}><IconCart /><span>Shopping list</span>{toBuy > 0 && <span className="badge">{toBuy}</span>}</a> },
            ]} />
          {(pinned.length > 0 || pinnedTags.length > 0) && (
            <SideSection id="pinned" title="Pinned" count={pinned.length + pinnedTags.length} fold={sideFold}>
              {pinned.map((d) => (
                <a key={d.path} href={docHref(d.path)} aria-current={route.view === "doc" && route.sub === d.path ? "page" : undefined}>
                  <span className="side-emoji" aria-hidden="true">{docEmoji(d)}</span><span className="clamp1" dir="auto">{docLabel(d)}</span>
                </a>
              ))}
              {pinnedTags.map((tag) => (
                <a key={"#" + tag} href={tagHref(tag)} aria-current={route.view === "tag" && route.sub === tag ? "page" : undefined}>
                  <span className="side-emoji muted" aria-hidden="true">#</span><span className="clamp1 grow" dir="auto">{tag}</span>
                  <span className="side-count">{ix.tags.get(tag)?.length ?? 0}</span>
                </a>
              ))}
            </SideSection>
          )}
          <SideSection id="topics" title="Topics" count={top.length} fold={sideFold}>
            {top.map((t) => (
              <a key={t.id} href={topicHref(t.id)} aria-current={route.view === "topics" && (route.sub === t.id || route.sub?.startsWith(t.id + "/")) ? "page" : undefined}>
                <span className="swatch sm" style={{ background: topicColor(t) }} /><span dir="auto">{t.name}</span>
              </a>
            ))}
          </SideSection>
        </div>
        <div className="side-foot"><DataPill onOpen={() => openSheet({ kind: "data" })} /></div>
      </aside>

      <header className="topbar">
        <a className="brand" href="#home" aria-label="Knowledge Hub, home">
          <img src={iconOf(accent)} alt="" width={28} height={28} />
          <span>Knowledge Hub</span>
        </a>
        <div className="top-actions">
          <DataPill onOpen={() => openSheet({ kind: "data" })} />
          <ReadingButton />
          <button type="button" className="icon-btn subtle" onClick={() => openSheet({ kind: "search" })} aria-label="Search"><IconSearch width={20} height={20} /></button>
        </div>
      </header>

      <main className={`main view-${route.view}`} key={`${route.view}/${route.sub ?? ""}`}>
        {!ready ? null
          : route.view === "topics" ? <Topics sub={route.sub} />
          : route.view === "library" ? <Library />
          : route.view === "notes" ? <Notes sub={route.sub} />
          : route.view === "inbox" ? <Inbox sub={route.sub} />
          : route.view === "habits" ? <Habits />
          : route.view === "recipes" ? <Recipes />
          : route.view === "paths" ? <Paths />
          : route.view === "shopping" ? <Shopping />
          : route.view === "review" ? <Review />
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
      {sheet?.kind === "data" && <DataSheet onClose={closeSheetReq} section={sheet.section} />}
      {sheet?.kind === "private" && <PrivateSheet then={sheet.then} onClose={closeSheetReq} />}
      {sheet?.kind === "shortcuts" && <ShortcutsSheet onClose={closeSheetReq} />}
      {sheet?.kind === "ask" && <AskSheet key={sheet.path} path={sheet.path} onClose={closeSheetReq} />}
      {sheet?.kind === "timer" && <TimerStartSheet key={sheet.path} path={sheet.path} onClose={closeSheetReq} />}
      {sheet?.kind === "shop" && <ShoppingSheet key={sheet.path} path={sheet.path} onClose={closeSheetReq} />}
      <Boundary quiet onClose={closeSheetReq} key={sheet ? `${sheet.kind}:${"path" in sheet ? sheet.path ?? "" : ""}` : "none"}>
        <Suspense fallback={null}>
          {sheet?.kind === "cook" && <CookMode key={sheet.path} path={sheet.path} onClose={closeSheetReq} />}
          {sheet?.kind === "sit" && <SitMode key={sheet.path} path={sheet.path} onClose={closeSheetReq} />}
          {sheet?.kind === "pdf" && <PdfReader key={sheet.path} path={sheet.path} page={sheet.page} onClose={closeSheetReq} />}
          {sheet?.kind === "sketch" && <SketchSheet key={sheet.path ?? "new"} path={sheet.path} note={sheet.note} onClose={closeSheetReq} />}
        </Suspense>
      </Boundary>
      <Boundary quiet>
        <Suspense fallback={null}>
          {sheet?.kind !== "sit" && hasSit && <SitDock onOpen={(path) => openSheet({ kind: "sit", path })} />}
          {sheet?.kind !== "cook" && !hasSit && hasTimers && <TimerDock onOpen={(path) => openSheet({ kind: "cook", path })} />}
        </Suspense>
      </Boundary>

      <nav className="tabbar" aria-label="Sections">
        {TABS.map(({ id, label, Icon }) => (
          <a key={id} href={`#${id}`} aria-current={tab === id ? "page" : undefined}><Icon /><span>{label}</span></a>
        ))}
      </nav>
    </div>
  );
}

interface SideFold { flipped: string[]; toggle: (id: string) => void }
interface SideItem { key: string; link: ReactNode; on?: boolean; count?: number }

/** A sidebar section (More, Pinned, Topics) that folds away from its heading; which ones are folded is per device.
   Folded, it shows its count, or with `items` the ones that matter now: the page you're on and any with a count. */
function SideSection({ id, title, count, fold, closedFirst, className = "side-topics", items, children }: {
  id: string; title: string; count?: number; fold: SideFold; closedFirst?: boolean; className?: string; items?: SideItem[]; children?: ReactNode;
}) {
  const open = fold.flipped.includes(id) === !!closedFirst;
  const peek = items?.filter((i) => i.on || (i.count ?? 0) > 0) ?? [];
  return (
    <nav className={`${className}${open ? "" : " folded"}`} aria-label={title}>
      <button type="button" className="side-head eyebrow" aria-expanded={open} onClick={() => fold.toggle(id)}>
        <IconChevronDown className="fold-chev" width={14} height={14} /> {title}{!open && count != null && <span className="side-count">{count}</span>}
      </button>
      {open ? <>{items?.map((i) => <Fragment key={i.key}>{i.link}</Fragment>)}{children}</> : peek.map((i) => <Fragment key={i.key}>{i.link}</Fragment>)}
    </nav>
  );
}
