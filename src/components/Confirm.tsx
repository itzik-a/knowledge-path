/* The confirm modal (src/lib/confirm.ts). Cancel has the focus, so Enter never deletes by accident. */
import { useEffect, useRef } from "react";
import { answerConfirm, useConfirm } from "../lib/confirm";

export function ConfirmDialog() {
  const req = useConfirm();
  if (!req) return null;
  return <Modal key={req.id} {...req} />;
}

function Modal({ title, body, ok = "Delete", danger = true }: { title: string; body?: string; ok?: string; danger?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const yes = useRef(false);
  const close = (v: boolean) => { yes.current = v; ref.current?.close(); };
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    d?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
    // Esc closes only this, never a sheet underneath (the browser may otherwise close stacked dialogs together)
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(false); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, []);
  return (
    <dialog ref={ref} className="dlg confirm" aria-labelledby="confirm-title" aria-describedby={body ? "confirm-body" : undefined}
      onClose={() => answerConfirm(yes.current)} onClick={(e) => { if (e.target === ref.current) close(false); }}>
      <div className="dlg-body">
        <h2 id="confirm-title" dir="auto">{title}</h2>
        {body && <p id="confirm-body" className="muted" dir="auto">{body}</p>}
        <div className="dlg-actions row">
          <button type="button" className="btn ghost" data-cancel onClick={() => close(false)}>Cancel</button>
          <button type="button" className={`btn ${danger ? "danger-fill" : "primary"}`} onClick={() => close(true)}>{ok}</button>
        </div>
      </div>
    </dialog>
  );
}
