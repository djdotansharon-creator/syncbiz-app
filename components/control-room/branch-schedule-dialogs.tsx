"use client";

/**
 * CONTROL ROOM — the window of "send a day to my other branches" (owner 2026-11-25, phase 2). OWNER only: the Control Room's own glass window (GlassModal: Esc closes, focus stays inside) with a checklist of the
 * other branches (+ "All branches") and a dry run ("7 fit, 2 can't be placed", the reasons on a tap). Send makes PENDING offers — nothing changes on the receiving branches before they say yes.
 * One fresh requestId per click, so a double click sends once; at most the server's cap of branches per send.
 * (The RECEIVING side is not a window any more: it is the offer screen, branch-schedule-offer.tsx.) All calls are in lib/schedule-day-share-client.ts; the server's refusals are shown in plain words.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { GlassModal } from "@/components/glass-modal";
import { useTr } from "@/lib/i18n/use-tr";
import { WEEKDAYS_FULL, cannotBePlaced, SEND_CAP_TEXT, newRequestId } from "@/lib/branch-schedule-lane";
import { previewSend, sendDay, type PreviewResult, type SendResult } from "@/lib/schedule-day-share-client";
import { DAY_SHARE_LIMITS } from "@/lib/schedule-day-share-rules";
import { WhyList, useBranches } from "@/components/control-room/branch-schedule-parts";

/** one send goes to at most this many branches (the server's own cap) */
const MAX_TARGETS = DAY_SHARE_LIMITS.MAX_TARGET_BRANCHES;

type Tr = ReturnType<typeof useTr>;

/** "7 fit, 2 can't be placed" */
function fitLine(fits: number, cannot: number, tr: Tr): string {
  const a = fits === 1 ? tr("1 fits") : tr("{n} fit", { n: fits });
  if (cannot === 0) return a;
  return `${a}, ${cannot === 1 ? tr("1 can't be placed") : tr("{n} can't be placed", { n: cannot })}`;
}

// ── SEND ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type PreviewState = { status: "loading" } | { status: "ready"; data: PreviewResult } | { status: "error"; error: string };

const TARGET_REASON: Record<string, string> = {
  "too-many-waiting": "Already has many waiting",
  "no-access": "You can't use this branch",
  "own-branch": "This is the branch it comes from",
  "not-a-branch-of-this-business": "Not a branch of this business",
};

export function SendDayDialog({ fromBranchId, fromName, weekday, onClose }: { fromBranchId: string; fromName: string; weekday: number; onClose: () => void }): ReactElement {
  const tr = useTr();
  const branches = useBranches();
  const others = useMemo(() => (branches ?? []).filter((b) => b.id !== fromBranchId), [branches, fromBranchId]);
  const [picked, setPicked] = useState<string[]>([]);
  const [pv, setPv] = useState<PreviewState>({ status: "loading" });
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<SendResult | null>(null);
  const dayName = tr(WEEKDAYS_FULL[weekday] ?? "Sunday");

  // the dry run: once the branches are known, one look at "what would go" (the same for every branch — it is the day that is checked)
  useEffect(() => {
    if (branches === null) return;
    if (others.length === 0) return;
    let alive = true;
    void previewSend({ fromBranchId, weekday, targetBranchIds: others.slice(0, MAX_TARGETS).map((b) => b.id) }).then((r) => {
      if (alive) setPv(r.ok ? { status: "ready", data: r.data } : { status: "error", error: r.error });
    });
    return () => { alive = false; };
  }, [branches, others, fromBranchId, weekday]);

  const skipReason = useMemo(() => {
    const m = new Map<string, string>();
    if (pv.status === "ready") for (const s of pv.data.skippedTargets) m.set(s.branchId, s.reason);
    return m;
  }, [pv]);
  const selectable = useMemo(() => others.filter((b) => !skipReason.has(b.id)), [others, skipReason]);
  const pickable = useMemo(() => selectable.slice(0, MAX_TARGETS), [selectable]);
  const allOn = pickable.length > 0 && pickable.every((b) => picked.includes(b.id));
  const someOn = picked.length > 0 && !allOn;
  const allBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (allBox.current) allBox.current.indeterminate = someOn; }, [someOn]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_TARGETS ? p : [...p, id]));
  const cannot = pv.status === "ready" ? cannotBePlaced(pv.data.skipped) : [];
  const canSend = pv.status === "ready" && picked.length > 0 && !busy && !sent;

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    setErr(null);
    // ONE fresh id per click: a retry of this very click (a double click, a slow network) is the same send on the server
    const r = await sendDay({ fromBranchId, weekday, targetBranchIds: picked.filter((id) => selectable.some((b) => b.id === id)), requestId: newRequestId() });
    setBusy(false);
    if (r.ok) setSent(r.data);
    else setErr(tr(r.error));
  };

  const nameOf = (id: string) => others.find((b) => b.id === id)?.name ?? tr("Another branch");

  return (
    <GlassModal
      title="Send this day"
      subtitle={fromName}
      showInitial
      width={520}
      closeOnBackdrop={!busy}
      onClose={onClose}
      footer={
        sent ? (
          <>
            <span className="sb-wz-spacer" />
            <button type="button" className="sb-wz-btn sb-wz-btn--primary" onClick={onClose} autoFocus>{tr("Done")}</button>
          </>
        ) : (
          <>
            <button type="button" className="sb-wz-btn" onClick={onClose} disabled={busy}>{tr("Cancel")}</button>
            <span className="sb-wz-spacer" />
            <button type="button" className="sb-wz-btn sb-wz-btn--primary" onClick={() => void send()} disabled={!canSend}>{busy ? "…" : tr("Send")}</button>
          </>
        )
      }
    >
      <div className="cr-sch-dlg">
        <p className="cr-sch-dlg-lead" dir="auto">{tr("{day}'s plan of {branch}", { day: dayName, branch: fromName })}</p>
        {sent ? (
          <div className="cr-sch-sent" role="status">
            <p className="cr-sch-sent-title" dir="auto">
              {sent.created.length === 1 ? tr("Sent to 1 branch.") : tr("Sent to {n} branches.", { n: sent.created.length })}
            </p>
            <p className="cr-sch-hint" dir="auto">{tr("Each branch is asked first. Nothing changes there until it says yes.")}</p>
            {sent.alreadySent.length > 0 ? <p className="cr-sch-hint" dir="auto">{sent.alreadySent.length === 1 ? tr("1 branch already had it.") : tr("{n} branches already had it.", { n: sent.alreadySent.length })}</p> : null}
            {sent.skippedTargets.length > 0 ? (
              <ul className="cr-sch-why" dir="auto">
                {sent.skippedTargets.map((t) => (
                  <li key={t.branchId}><b dir="auto">{nameOf(t.branchId)}</b> <span>{tr(TARGET_REASON[t.reason] ?? "Not sent")}</span></li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : branches === null ? (
          <p className="cr-sch-quiet"><span className="cr-sch-spin" role="status" aria-label={tr("Loading")} /></p>
        ) : others.length === 0 ? (
          <p className="cr-sch-quiet">{tr("There are no other branches yet.")}</p>
        ) : (
          <>
            <p className="cr-sch-hint" dir="auto">{tr("Each branch is asked first. Nothing changes there until it says yes.")}</p>
            <p className="cr-sch-dry" aria-live="polite" dir="auto">
              {pv.status === "loading" ? <span className="cr-sch-spin" role="status" aria-label={tr("Loading")} /> : null}
              {pv.status === "ready" ? (
                <>
                  <b>{fitLine(pv.data.summary.fits, pv.data.summary.cannot, tr)}</b>
                  {cannot.length > 0 ? (
                    <>
                      {" "}
                      <button type="button" className="cr-sch-link" aria-expanded={why} onClick={() => setWhy((v) => !v)}>{why ? tr("Hide") : tr("Show why")}</button>
                    </>
                  ) : null}
                </>
              ) : null}
              {pv.status === "error" ? <span className="cr-sch-err" role="alert">{tr(pv.error)}</span> : null}
            </p>
            {why && cannot.length > 0 ? <WhyList skipped={cannot} /> : null}
            {pv.status === "ready" && pv.data.summary.kept > 0 ? <p className="cr-sch-hint" dir="auto">{tr("Each branch keeps its own closing.")}</p> : null}

            <fieldset className="cr-sch-pick">
              <legend className="cr-sch-pick-legend">{tr("Send to")}{others.length > MAX_TARGETS ? <span className="cr-sch-pick-cap"> · {tr(SEND_CAP_TEXT)}</span> : null}</legend>
              <label className="cr-sch-check is-all">
                <input
                  ref={allBox}
                  type="checkbox"
                  checked={allOn}
                  disabled={selectable.length === 0}
                  onChange={() => setPicked(allOn ? [] : pickable.map((b) => b.id))}
                />
                <span dir="auto">{tr("All branches")}</span>
              </label>
              <ul className="cr-sch-pick-list">
                {others.map((b) => {
                  const reason = skipReason.get(b.id);
                  return (
                    <li key={b.id}>
                      <label className={`cr-sch-check${reason ? " is-off" : ""}`}>
                        <input type="checkbox" checked={picked.includes(b.id)} disabled={!!reason || (!picked.includes(b.id) && picked.length >= MAX_TARGETS)} onChange={() => toggle(b.id)} />
                        <span dir="auto">{b.name}</span>
                        {reason ? <small>{tr(TARGET_REASON[reason] ?? "Not now")}</small> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            {err ? <p className="cr-sch-err" role="alert">{err}</p> : null}
          </>
        )}
      </div>
    </GlassModal>
  );
}

