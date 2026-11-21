/* #inbox: resources and notes without a topic. Give each one a topic (the enricher's suggestions first) and it moves on. */
import { inbox, type Doc, type Index } from "../../shared/index.ts";
import { DocRow, TopicPicker } from "../components/bits";
import { IconPlus } from "../components/Icons";
import { openSheet } from "../lib/sheets";
import { setTopics } from "../state/actions";
import { useIndex } from "../state/store";

export function Inbox() {
  const ix = useIndex();
  const items = inbox(ix);
  return (
    <>
      <div className="page-head row-head">
        <div>
          <h1 className="display">Inbox</h1>
          <p className="muted">{items.length ? `${items.length} waiting for a topic` : "All sorted"}</p>
        </div>
        <button type="button" className="btn primary sm" onClick={() => openSheet({ kind: "capture", init: {} })}><IconPlus /> Add</button>
      </div>
      {items.map((d) => <InboxItem key={d.path} d={d} ix={ix} />)}
      {!items.length && <div className="card empty"><p className="muted">Things you save without a topic wait here until you file them.</p></div>}
    </>
  );
}

function InboxItem({ d, ix }: { d: Doc; ix: Index }) {
  const suggested = (d.resource?.suggestedTopics ?? [])
    .map((n) => [...ix.topics.values()].find((t) => t.name.toLowerCase() === n.toLowerCase() || t.id.toLowerCase() === n.toLowerCase())?.id)
    .filter((x): x is string => !!x);
  return (
    <section className="card inbox-item">
      <ul className="item-list"><DocRow d={d} ix={ix} showTopics={false} /></ul>
      {d.resource?.summary && <p className="small" dir="auto">{d.resource.summary}</p>}
      <TopicPicker value={[]} onChange={(ids) => setTopics(d.path, ids)} suggested={suggested} />
    </section>
  );
}
