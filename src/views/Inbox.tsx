/* #inbox: resources and notes without a topic. Give each one a topic (the enricher's suggestions first) and it moves on,
   or keep it without one (`inbox: false`; Back to Inbox in its page's More menu undoes that). */
import { inbox, type Doc, type Index } from "../../shared/index.ts";
import { DocRow, TopicPicker } from "../components/bits";
import { SelectBar, SelectButton, useSelection, type Selection } from "../components/Select";
import { IconPlus } from "../components/Icons";
import { openSheet } from "../lib/sheets";
import { setKeptOutOfInbox, setTopics } from "../state/actions";
import { useIndex } from "../state/store";

export function Inbox() {
  const ix = useIndex();
  const items = inbox(ix);
  const sel = useSelection(items.map((d) => d.path));
  return (
    <>
      <div className="page-head row-head">
        <div>
          <h1 className="display">Inbox</h1>
          <p className="muted">{items.length ? `${items.length} waiting for a topic` : "All sorted"}</p>
        </div>
        <div className="head-actions">
          <SelectButton sel={sel} />
          {!sel.on && <button type="button" className="btn primary sm" onClick={() => openSheet({ kind: "capture", init: {} })}><IconPlus /> Add</button>}
        </div>
      </div>
      {items.map((d) => <InboxItem key={d.path} d={d} ix={ix} sel={sel} />)}
      <SelectBar sel={sel} />
      {!items.length && <div className="card empty"><p className="muted">Things you save without a topic wait here until you file them, or keep them without one.</p></div>}
    </>
  );
}

function InboxItem({ d, ix, sel }: { d: Doc; ix: Index; sel: Selection }) {
  const suggested = (d.resource?.suggestedTopics ?? [])
    .map((n) => [...ix.topics.values()].find((t) => t.name.toLowerCase() === n.toLowerCase() || t.id.toLowerCase() === n.toLowerCase())?.id)
    .filter((x): x is string => !!x);
  return (
    <section className="card inbox-item">
      <ul className="item-list"><DocRow d={d} ix={ix} showTopics={false} sel={sel} /></ul>
      {d.resource?.summary && <p className="small" dir="auto">{d.resource.summary}</p>}
      {!sel.on && (
        <>
          <TopicPicker value={[]} onChange={(ids) => setTopics(d.path, ids)} suggested={suggested} />
          <button type="button" className="text-btn small inbox-keep" onClick={() => setKeptOutOfInbox(d.path, true)}>Keep without a topic</button>
        </>
      )}
    </section>
  );
}
