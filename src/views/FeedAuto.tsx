/* Automatic runs (Feed settings): off by default (the collector runs only on Run now). Turning them on writes the
   scheduled workflow into the vault (.github/workflows/feed-schedule.yml, `scheduleWorkflow()`), built from the
   summary times and the 3-hourly reading; changing them rewrites it, turning them off deletes it. GitHub runs on a
   schedule only from such a file, which the vault token may write only with its Workflows permission: without it the
   change isn't made and the card says how to add it. The card compares GitHub's copy with the settings (another
   device may have changed them) and offers Apply when they differ. */
import { useEffect, useState } from "react";
import { SCHEDULE_WORKFLOW_PATH, nextSummary, scheduleWorkflow, type AutoRuns } from "../../shared/feed.ts";
import { IconClose, IconPlus } from "../components/Icons";
import { Switch } from "../components/ui";
import { showToast } from "../lib/toast";
import { updateFeedSettings, useFeedSettings } from "../state/feed";
import { GitHubError, readVaultText, setWorkflowFile } from "../state/sync";

const same = (a: AutoRuns, b: AutoRuns) => a.on === b.on && a.read === b.read && a.times.join() === b.times.join();
const clean = (a: AutoRuns): AutoRuns => ({ ...a, times: [...new Set(a.times.filter((t) => /^\d\d:\d\d$/.test(t)))].sort().slice(0, 3) });

export function AutoRunsCard() {
  const settings = useFeedSettings();
  const auto = settings.auto;
  const [draft, setDraft] = useState<AutoRuns>(auto);
  /** GitHub's copy: undefined while checking, null when there's none */
  const [actual, setActual] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; permission?: boolean } | null>(null);

  const autoKey = `${auto.on}|${auto.read}|${auto.times.join()}`;
  useEffect(() => { setDraft(auto); }, [autoKey]); // follow a change from another device
  useEffect(() => {
    let live = true;
    readVaultText(SCHEDULE_WORKFLOW_PATH).then((t) => { if (live) setActual(t ?? null); }).catch(() => { if (live) setActual(undefined); });
    return () => { live = false; };
  }, []);

  async function apply(next: AutoRuns) {
    const n = clean(next);
    setBusy(true);
    setErr(null);
    try {
      const text = n.on ? scheduleWorkflow(n) : null;
      if (text !== actual) await setWorkflowFile(SCHEDULE_WORKFLOW_PATH, text, n.on ? `Feed: automatic runs at ${n.times.join(", ")} (Israel time)${n.read ? ", reading every 3 hours" : ""}` : "Feed: automatic runs off");
      setActual(text);
      if (!same(n, auto)) updateFeedSettings((s) => { s.auto = n; }, { prefs: true });
      showToast(n.on ? "Automatic runs on" : "Automatic runs off");
    } catch (e) {
      const status = e instanceof GitHubError ? e.status : 0;
      setErr(status === 403 || status === 404
        ? { text: "GitHub didn't let the app write the schedule into the vault.", permission: true }
        : { text: `Couldn't change the schedule on GitHub: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const want = auto.on ? scheduleWorkflow(auto) : null;
  const mismatch = actual !== undefined && actual !== want;
  const dirty = !same(clean(draft), auto);
  const next = nextSummary(Date.now(), auto);

  return (
    <section className="card" aria-labelledby="fs-auto">
      <div className="card-head">
        <h2 id="fs-auto">Automatic runs</h2>
        <Switch on={auto.on} label="Automatic runs" onChange={(on) => { if (!busy) void apply({ ...clean(draft), on }); }} />
      </div>
      <p className="muted small">
        {auto.on
          ? <>On: summaries at {auto.times.join(", ")} (Israel time){auto.read ? ", and the sources read every 3 hours between them so busy feeds don't drop items" : ""}.{next ? ` Next around ${new Date(next).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}.` : ""}</>
          : <>Off: the feed runs only when you press Run now, and costs no GitHub Actions minutes. Without reading every 3 hours, a run sees only what each feed still lists (busy ones like Ynet reach back about 16 hours).</>}
      </p>

      <div className="auto-times">
        <span className="field-label">Summary times (Israel)</span>
        {draft.times.map((t, i) => (
          <span key={i} className="auto-time">
            <input type="time" className="text-input" value={t} aria-label={`Summary time ${i + 1}`} onChange={(e) => setDraft({ ...draft, times: draft.times.map((x, j) => (j === i ? e.target.value : x)) })} />
            {draft.times.length > 1 && <button type="button" className="icon-btn subtle" aria-label="Remove this time" onClick={() => setDraft({ ...draft, times: draft.times.filter((_, j) => j !== i) })}><IconClose width={18} height={18} /></button>}
          </span>
        ))}
        {draft.times.length < 3 && <button type="button" className="text-btn" onClick={() => setDraft({ ...draft, times: [...draft.times, "18:00"] })}><IconPlus width={16} height={16} /> Add a time</button>}
      </div>
      <label className="switch-row">
        <Switch on={draft.read} label="Read the sources every 3 hours" onChange={(read) => setDraft({ ...draft, read })} />
        <span>Read the sources every 3 hours between summaries <span className="muted small">(no Claude)</span></span>
      </label>
      {dirty && <button type="button" className="btn primary" disabled={busy} onClick={() => void apply({ ...draft, on: auto.on })}>{auto.on ? "Save and update the schedule" : "Save"}</button>}

      {mismatch && !dirty && !err && (
        <p className="small note-line">
          {want ? "These settings aren't on GitHub yet, so automatic runs aren't happening as set here." : "GitHub still has a schedule from before."}{" "}
          <button type="button" className="text-btn" disabled={busy} onClick={() => void apply(auto)}>{want ? "Apply" : "Remove it"}</button>
        </p>
      )}
      {err && (
        <div className="form-error small" role="alert">
          <p>{err.text}</p>
          {err.permission && (
            <p className="muted">
              Writing a workflow needs one more permission on the vault's token: on GitHub, Settings → Developer settings → Fine-grained tokens → the token you gave
              Knowledge Path → Repository permissions → <b>Workflows: Read and write</b> → Update. Then try again. (Run now doesn't need it.)
            </p>
          )}
        </div>
      )}
      {auto.on && <p className="muted small">Uses about {auto.read ? "300–400" : 90 * auto.times.length} GitHub Actions minutes a month of the free 2,000 (the vault is private).</p>}
    </section>
  );
}
