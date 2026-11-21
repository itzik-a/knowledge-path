/* Explore a topic with Claude. Asking writes a request file into the vault; the vault's GitHub Action asks
   Claude (Opus) and writes the answer to .hub/explore/<topic>.json, which arrives with the next sync.
   While a request is out, this card syncs every 20 s. Suggested reads go into the library in one tap. */
import { useEffect, useState, type FormEvent } from "react";
import type { Index, Topic } from "../../shared/index.ts";
import { explorePath, type ExploreResult } from "../../shared/vault.ts";
import { ago } from "../lib/dates";
import { docHref, go } from "../lib/route";
import { openSheet } from "../lib/sheets";
import { showToast } from "../lib/toast";
import { createResource, requestExplore } from "../state/actions";
import { allRecords, readFile, useVault } from "../state/store";
import { getConfig, syncNow } from "../state/sync";
import { TYPE_EMOJI } from "./bits";
import { IconPlus, IconSpark } from "./Icons";

function pendingFor(id: string) {
  return allRecords().filter((r) => !r.deleted && r.path.startsWith(".hub/requests/") && r.path.endsWith(".json")).some((r) => {
    try { return (JSON.parse(r.content) as { topic?: string }).topic === id; } catch { return false; }
  });
}

export function Explore({ t, ix }: { t: Topic; ix: Index }) {
  useVault();
  const raw = readFile(explorePath(t.id));
  let res: ExploreResult | null = null;
  try { res = raw ? (JSON.parse(raw) as ExploreResult) : null; } catch { res = null; }
  const pending = pendingFor(t.id);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(false);
  const connected = !!getConfig();

  useEffect(() => {
    if (!pending || !connected) return;
    const iv = setInterval(() => { if (document.visibilityState === "visible") void syncNow(); }, 20_000);
    return () => clearInterval(iv);
  }, [pending, connected]);

  function send(e?: FormEvent) {
    e?.preventDefault();
    requestExplore(t.id, ask);
    setAsk("");
    setAsking(false);
    void syncNow();
    showToast("Asked Claude: the answer arrives in a minute or two");
  }

  const have = new Set([...ix.docs.values()].filter((d) => d.kind === "resource").map((d) => d.title.toLowerCase()));

  return (
    <section className="card explore">
      <div className="card-head">
        <h2><IconSpark /> Explore</h2>
        {res && !pending && <button type="button" className="btn ghost sm" onClick={() => setAsking((x) => !x)}>{asking ? "Cancel" : "Ask again"}</button>}
      </div>

      {pending ? (
        <p className="muted small explore-wait"><span className="dot busy" /> Claude is looking into {t.name}… The answer arrives with a sync in a minute or two.</p>
      ) : !res || asking ? (
        connected ? (
          <form className="form-grid" onSubmit={send}>
            {!res && <p className="muted small">Ask Claude for a map of {t.name}: the big questions, key people{t.depth === 0 ? ", a timeline" : ""}, and what to read next given what you've saved.</p>}
            <textarea className="text-input" dir="auto" rows={2} placeholder={`A question about ${t.name} (optional)`} value={ask} onChange={(e) => setAsk(e.target.value)} />
            <button type="submit" className="btn primary sm"><IconSpark /> {res ? "Ask" : `Explore ${t.name}`}</button>
          </form>
        ) : (
          <p className="muted small">Explore asks Claude through your vault on GitHub. <button type="button" className="text-btn" onClick={() => openSheet({ kind: "data" })}>Connect the vault</button> first.</p>
        )
      ) : null}

      {res && (
        <div className="explore-body">
          {res.answer && (
            <div className="explore-answer">
              {res.ask && <p className="eyebrow" dir="auto">“{res.ask}”</p>}
              {res.answer.split(/\n\s*\n/).map((p, i) => <p key={i} dir="auto">{p}</p>)}
            </div>
          )}
          <p dir="auto">{res.overview}</p>
          {!open ? (
            <button type="button" className="text-btn" onClick={() => setOpen(true)}>Show the whole map: {[res.reads.length && `${res.reads.length} reads`, res.people.length && `${res.people.length} people`, res.questions.length && "open questions"].filter(Boolean).join(", ")}</button>
          ) : (
            <>
              {res.reads.length > 0 && (
                <div className="explore-sec">
                  <h3>What to read next</h3>
                  <ul className="explore-reads">
                    {res.reads.map((r) => {
                      const saved = have.has(r.title.toLowerCase());
                      return (
                        <li key={r.title}>
                          <span className="thumb emoji sm" aria-hidden="true">{TYPE_EMOJI[r.type]}</span>
                          <span className="item-main">
                            <span className="item-title" dir="auto">{r.title}</span>
                            <span className="item-meta" dir="auto">{r.author} · {r.level}</span>
                            <span className="small" dir="auto">{r.why}</span>
                          </span>
                          {saved ? <span className="muted small">Saved</span> : (
                            <button type="button" className="icon-btn" aria-label={`Save ${r.title}`} onClick={() => {
                              const p = createResource({ title: r.title, author: r.author, type: r.type, topics: [t.id], status: "saved" });
                              showToast(`Saved ${r.title}`, { label: "Open", run: () => go(docHref(p)) });
                            }}><IconPlus /></button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {res.questions.length > 0 && (
                <div className="explore-sec"><h3>Open questions</h3><ul className="bullets">{res.questions.map((q) => <li key={q} dir="auto">{q}</li>)}</ul></div>
              )}
              {res.people.length > 0 && (
                <div className="explore-sec">
                  <h3>Key people</h3>
                  <dl className="explore-people">{res.people.map((p) => <div key={p.name}><dt dir="auto">{p.name} <span className="muted">{p.years}</span></dt><dd className="muted small" dir="auto">{p.why}</dd></div>)}</dl>
                </div>
              )}
              {res.timeline.length > 0 && (
                <div className="explore-sec">
                  <h3>Timeline</h3>
                  <ol className="timeline">{res.timeline.map((x) => <li key={x.when + x.what}><b>{x.when}</b><span dir="auto">{x.what}</span></li>)}</ol>
                </div>
              )}
              {res.subtopics.length > 0 && (
                <div className="explore-sec">
                  <h3>Areas to explore</h3>
                  <ul className="explore-subs">
                    {res.subtopics.map((s) => {
                      const exists = t.children.some((c) => ix.topics.get(c)?.name.toLowerCase() === s.name.toLowerCase());
                      return (
                        <li key={s.name}>
                          <span className="grow"><b dir="auto">{s.name}</b> <span className="muted small" dir="auto">{s.why}</span></span>
                          {!exists && <button type="button" className="btn ghost sm" onClick={() => openSheet({ kind: "topic", parent: t.id })}>Add</button>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {res.next && <div className="explore-sec"><h3>What to do next</h3><p dir="auto">{res.next}</p></div>}
            </>
          )}
          <p className="muted small">By Claude ({res.model.replace("claude-", "").replace(/-(\d)-(\d)$/, " $1.$2").replace(/^\w/, (c) => c.toUpperCase())}) · {ago(Date.parse(res.at))}. Check anything important against a source.</p>
        </div>
      )}
    </section>
  );
}
