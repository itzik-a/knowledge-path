/* #paths: every study path and roadmap in one place, by how far along they are, including those without a topic
   (which no topic page lists). */
import { useMemo } from "react";
import { byRecentlyUpdated, type Doc } from "../../shared/index.ts";
import { PathRow, pathProgress } from "../components/bits";
import { IconPlus } from "../components/Icons";
import { SelectBar, SelectButton, useSelection } from "../components/Select";
import { docHref, go } from "../lib/route";
import { createPath } from "../state/actions";
import { useIndex } from "../state/store";

export function Paths() {
  const ix = useIndex();
  const groups = useMemo(() => {
    const all = [...ix.docs.values()].filter((d) => d.kind === "path").sort(byRecentlyUpdated);
    const g: Record<"going" | "fresh" | "done", Doc[]> = { going: [], fresh: [], done: [] };
    for (const d of all) {
      const p = pathProgress(d);
      g[p.total > 0 && p.done === p.total ? "done" : p.done > 0 ? "going" : "fresh"].push(d);
    }
    return g;
  }, [ix]);
  const order = [...groups.going, ...groups.fresh, ...groups.done];
  const sel = useSelection(order.map((d) => d.path));
  const topicless = order.filter((d) => !(ix.topicsOf.get(d.path) ?? []).length).length;
  const section = (title: string, docs: Doc[]) => docs.length > 0 && (
    <section className="card">
      <div className="card-head"><h2>{title} <span className="muted">· {docs.length}</span></h2></div>
      <ul className="item-list">{docs.map((d) => <PathRow key={d.path} d={d} ix={ix} sel={sel} />)}</ul>
    </section>
  );
  return (
    <>
      <div className="page-head row-head">
        <div>
          <h1 className="display">Study paths</h1>
          <p className="muted">{order.length} paths{topicless ? ` · ${topicless} without a topic` : ""}</p>
        </div>
        <div className="head-actions">
          <SelectButton sel={sel} />
          {!sel.on && <button type="button" className="btn primary sm" onClick={() => go(docHref(createPath("New study path", [])))}><IconPlus /> Path</button>}
        </div>
      </div>
      {section("In progress", groups.going)}
      {section("Not started", groups.fresh)}
      {section("Done", groups.done)}
      {!order.length && <div className="card empty"><p className="muted">No study paths yet. Make one here, from a topic's page, or by selecting items in the Library and choosing Make a study path.</p></div>}
      <SelectBar sel={sel} />
    </>
  );
}
