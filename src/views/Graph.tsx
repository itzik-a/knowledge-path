/* The graph view (#notes/graph), like Obsidian's: every note as a dot, every link as a line.
   #notes/graph?of=<path> is a note's local graph (what's within 1–3 links of it).
   Filters, colours, display and forces are per device (localStorage knowledgePath.graph). */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { buildGraph, DEFAULT_SHOW, type GraphNode, type GraphShow, type NodeKind } from "../../shared/graph.ts";
import type { Index } from "../../shared/index.ts";
import { DEFAULT_DISPLAY, GraphCanvas, type GraphDisplay } from "../components/GraphCanvas";
import { IconClose, IconSliders } from "../components/Icons";
import { Seg, Switch, useLocalState } from "../components/ui";
import { DEFAULT_FORCES, type Forces } from "../lib/force";
import { docHref, go, readHash, tagHref } from "../lib/route";
import { createNote } from "../state/actions";
import { useIndex } from "../state/store";
import { NotesHead } from "./Notes";

interface Prefs {
  show: GraphShow;
  /** the local graph's own filters (it has its own, as in Obsidian) */
  localShow: GraphShow;
  depth: number;
  color: "topic" | "kind";
  display: GraphDisplay;
  forces: Forces;
}
const DEFAULT_PREFS: Prefs = {
  show: DEFAULT_SHOW,
  localShow: { ...DEFAULT_SHOW, chapters: true, tags: false },
  depth: 1, color: "topic", display: DEFAULT_DISPLAY, forces: DEFAULT_FORCES,
};

/** Saved prefs over the defaults, so a setting added later still has a value. */
function usePrefs() {
  const [raw, setRaw] = useLocalState<Partial<Prefs>>("knowledgePath.graph", {});
  const prefs: Prefs = {
    ...DEFAULT_PREFS, ...raw,
    show: { ...DEFAULT_PREFS.show, ...raw.show },
    localShow: { ...DEFAULT_PREFS.localShow, ...raw.localShow },
    display: { ...DEFAULT_PREFS.display, ...raw.display },
    forces: { ...DEFAULT_PREFS.forces, ...raw.forces },
  };
  const set = (p: Partial<Prefs>) => setRaw((r) => ({ ...r, ...p }));
  return [prefs, set, () => setRaw({})] as const;
}

/** Colour by type: a fixed series colour per kind (the legend says which). */
const KIND_COLOR: Partial<Record<NodeKind, number | "accent">> = { note: 1, topic: 2, resource: 3, journal: 4, path: 5, habit: 6, chapter: 7, recipe: 8, tag: "accent" };
const KIND_NAME: Record<NodeKind, string> = {
  note: "Notes", topic: "Topics", resource: "Saved links", journal: "Journal", path: "Study paths", habit: "Habits", chapter: "Book chapters", recipe: "Recipes", tag: "Tags", missing: "Not written yet",
};

export function GraphPage() {
  const ix = useIndex();
  const of = readHash().params.get("of") ?? undefined;
  const center = of && ix.docs.has(of) ? of : undefined;
  const [prefs, setPrefs, reset] = usePrefs();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const show = center ? prefs.localShow : prefs.show;

  const graph = useMemo(
    () => buildGraph(ix, { show, search: q, local: center ? { path: center, depth: prefs.depth } : undefined }),
    // `show` by value: the prefs object is new on every render
    [ix, JSON.stringify(show), q, center, prefs.depth],
  );

  const colorOf = useCallback((n: GraphNode): number | "accent" | undefined => {
    if (n.kind === "missing") return undefined;
    if (prefs.color === "kind") return KIND_COLOR[n.kind];
    if (n.kind === "tag") return "accent";
    return n.topic ? ix.topics.get(n.topic)?.color : undefined;
  }, [prefs.color, ix]);

  const onOpen = useCallback((n: GraphNode) => {
    if (n.kind === "tag") go(tagHref(n.id.slice(4)));
    else if (n.kind === "missing") go(docHref(createNote({ title: n.label })));
    else go(docHref(n.id));
  }, []);

  const links = graph.edges.length;
  const label = `Graph of ${graph.nodes.length} ${graph.nodes.length === 1 ? "item" : "items"} and ${links} ${links === 1 ? "link" : "links"}`;
  const title = center ? ix.docs.get(center)!.title : undefined;

  return (
    <div className="graph-page">
      <NotesHead tab="graph" />
      <GraphCanvas graph={graph} colorOf={colorOf} forces={prefs.forces} display={prefs.display} focus={center} onOpen={onOpen} label={label}
        panel={open && <GraphSettings ix={ix} prefs={prefs} set={setPrefs} reset={reset} local={!!center} onClose={() => setOpen(false)} />}>
        <div className="graph-bar">
          <input className="graph-filter" type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name…" aria-label="Filter the graph by name" />
          <button type="button" className={`icon-btn${open ? " on" : ""}`} aria-pressed={open} aria-label="Graph settings" title="Graph settings" onClick={() => setOpen((x) => !x)}><IconSliders /></button>
        </div>
        {center && (
          <div className="graph-local">
            <span className="muted small">Around</span>
            <a className="clamp1" dir="auto" href={docHref(center)}>{title}</a>
            <Seg<number> label="How many links away" value={prefs.depth} onChange={(depth) => setPrefs({ depth })}
              options={[1, 2, 3].map((n) => ({ id: n, label: n }))} />
            <a className="icon-btn subtle" href="#notes/graph" aria-label="The whole graph" title="The whole graph"><IconClose /></a>
          </div>
        )}
        <p className="graph-count muted small" aria-hidden="true">{graph.nodes.length} {graph.nodes.length === 1 ? "item" : "items"} · {links} {links === 1 ? "link" : "links"}</p>
      </GraphCanvas>
    </div>
  );
}

function GraphSettings({ ix, prefs, set, reset, local, onClose }: { ix: Index; prefs: Prefs; set: (p: Partial<Prefs>) => void; reset: () => void; local: boolean; onClose: () => void }) {
  const show = local ? prefs.localShow : prefs.show;
  const setShow = (k: keyof GraphShow, v: boolean) => set(local ? { localShow: { ...show, [k]: v } } : { show: { ...show, [k]: v } });
  const toggles: [keyof GraphShow, string][] = [
    ["topics", "Topics"], ["resources", "Saved links"], ["journal", "Journal"], ["chapters", "Book chapters"],
    ["other", "Habits, recipes, study paths"], ["tags", "Tags"], ["missing", "Links to notes not written yet"],
    ...(local ? [] : [["orphans", "Notes with no links"] as [keyof GraphShow, string]]),
  ];
  const topTopics = ix.topicOrder.map((id) => ix.topics.get(id)!).filter((t) => !t.parent);
  const legend: { key: string; label: string; c: number | "accent" | undefined }[] = prefs.color === "kind"
    ? (Object.keys(KIND_NAME) as NodeKind[]).filter((k) => k === "note" || (k === "missing" ? show.missing : k === "tag" ? show.tags : show[kindSwitch(k)]))
      .map((k) => ({ key: k, label: KIND_NAME[k], c: KIND_COLOR[k] }))
    : [...topTopics.map((t) => ({ key: t.id, label: t.name, c: t.color })), ...(show.tags ? [{ key: "#", label: "Tags", c: "accent" as const }] : []), { key: "-", label: "No topic", c: undefined }];
  const d = prefs.display, f = prefs.forces;
  return (
    <section className="card graph-settings" aria-label="Graph settings">
      <div className="card-head">
        <h2>{local ? "Local graph" : "Graph"} settings</h2>
        <button type="button" className="btn ghost sm" onClick={onClose}>Done</button>
      </div>
      <Group title="Show">
        {toggles.map(([k, label]) => (
          <div key={k} className="graph-switch"><span>{label}</span><Switch on={show[k]} onChange={(v) => setShow(k, v)} label={label} /></div>
        ))}
      </Group>
      <Group title="Colour">
        <Seg<Prefs["color"]> label="Colour by" className="full" value={prefs.color} onChange={(color) => set({ color })}
          options={[{ id: "topic", label: "By topic" }, { id: "kind", label: "By type" }]} />
        <ul className="graph-legend">
          {legend.map((l) => (
            <li key={l.key}><span className={`graph-dot${l.key === "missing" ? " hollow" : l.c === undefined ? " none" : ""}`} style={l.c === undefined ? undefined : { background: l.c === "accent" ? "var(--accent)" : `var(--s${l.c})` }} /><span dir="auto">{l.label}</span></li>
          ))}
        </ul>
      </Group>
      <Group title="Display">
        <Range label="Names show" value={d.labels} min={0} max={1} step={0.05} lo="sooner" hi="closer in" onChange={(labels) => set({ display: { ...d, labels } })} />
        <Range label="Node size" value={d.size} min={0.5} max={2} step={0.05} onChange={(size) => set({ display: { ...d, size } })} />
        <Range label="Link thickness" value={d.thickness} min={0.5} max={3} step={0.1} onChange={(thickness) => set({ display: { ...d, thickness } })} />
      </Group>
      <Group title="Forces">
        <Range label="Centre force" value={f.center} min={0} max={2} step={0.05} onChange={(center) => set({ forces: { ...f, center } })} />
        <Range label="Repel force" value={f.repel} min={0} max={3} step={0.05} onChange={(repel) => set({ forces: { ...f, repel } })} />
        <Range label="Link force" value={f.link} min={0} max={2} step={0.05} onChange={(link) => set({ forces: { ...f, link } })} />
        <Range label="Link distance" value={f.distance} min={0.2} max={4} step={0.05} onChange={(distance) => set({ forces: { ...f, distance } })} />
      </Group>
      <button type="button" className="btn ghost sm" onClick={reset}>Back to the defaults</button>
    </section>
  );
}

const kindSwitch = (k: NodeKind): keyof GraphShow =>
  k === "topic" ? "topics" : k === "resource" ? "resources" : k === "journal" ? "journal" : k === "chapter" ? "chapters" : "other";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div className="graph-group"><span className="eyebrow">{title}</span>{children}</div>;
}

function Range({ label, value, min, max, step, lo, hi, onChange }: { label: string; value: number; min: number; max: number; step: number; lo?: string; hi?: string; onChange: (v: number) => void }) {
  return (
    <label className="range-row">
      <span className="range-label"><span>{label}</span>{lo && hi && <span className="muted small">{lo} ↔ {hi}</span>}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
