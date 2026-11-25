"use client";

/**
 * CONTROL ROOM — the two small windows of "send a day to my other branches" (owner 2026-11-25, phase 2). Both are the Control Room's own glass window (GlassModal: Esc closes, focus stays inside).
 *   · SendDayDialog — OWNER: a checklist of the other branches (+ "All branches") and a dry run ("7 fit, 2 can't be placed", the reasons on a tap). Send makes PENDING offers — nothing changes on the
 *     receiving branches before they say yes. One fresh requestId per click, so a double click sends once.
 *   · UseDayDialog — the RECEIVING branch: "which day?" — a weekly routine on chosen weekdays, or ONE date (not in the past) — then what will happen (a dry run first), then Use this.
 *     "Replace that day" is the default when the branch already has blocks that day (its own blocks are switched off, never deleted); "Keep both" only adds.
 * All calls are in lib/schedule-day-share-client.ts; the server decides who may do what and its refusals are shown in plain words.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { GlassModal } from "@/components/glass-modal";
import { useTr } from "@/lib/i18n/use-tr";
import type { Schedule } from "@/lib/types";
import {
  WEEKDAYS_FULL,
  WEEKDAYS_SHORT,
  cannotBePlaced,
  SEND_CAP_TEXT,
  newRequestId,
  nextDateOfWeekday,
  reasonText,
  snapshotLane,
  todayYmd,
  weekdayOfDate,
} from "@/lib/branch-schedule-lane";
import {
  acceptOffer,
  previewAccept,
  previewSend,
  sendDay,
  type AcceptPreview,
  type ApplyChoice,
  type OfferView,
  type PreviewResult,
  type SendResult,
} from "@/lib/schedule-day-share-client";
import { DAY_SHARE_LIMITS, type SkippedBlock } from "@/lib/schedule-day-share-rules";
import { DayLane, useBranches } from "@/components/control-room/branch-schedule-parts";

/** one send goes to at most this many branches (the server's own cap) */
const MAX_TARGETS = DAY_SHARE_LIMITS.MAX_TARGET_BRANCHES;

type Tr = ReturnType<typeof useTr>;

function WhyList({ skipped, tr }: { skipped: SkippedBlock[]; tr: Tr }): ReactElement {
  return (
    <ul className="cr-sch-why" dir="auto">
      {skipped.map((s, i) => (
        <li key={i}>
          <bdi className="cr-sch-small-time">{s.time.slice(0, 5)}</bdi> <b dir="auto">{s.targetName ?? s.name ?? tr("Music")}</b> <span>{tr(reasonText(s))}</span>
        </li>
      ))}
    </ul>
  );
}

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
            {why && cannot.length > 0 ? <WhyList skipped={cannot} tr={tr} /> : null}
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

// ── USE ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** how many blocks this branch already has on the days the offer would land on (a weekly routine on those weekdays, or what runs on that date) */
function ownBlocksOn(items: Schedule[], c: ApplyChoice | null): number {
  if (!c) return 0;
  const live = items.filter((s) => s.enabled);
  if (c.mode === "weekday") return live.filter((s) => s.recurrence !== "one_off" && Array.isArray(s.daysOfWeek) && s.daysOfWeek.some((d) => c.weekdays.includes(d))).length;
  const wd = weekdayOfDate(c.date);
  return live.filter((s) => (s.recurrence === "one_off" ? s.oneOffDateLocal === c.date : Array.isArray(s.daysOfWeek) && s.daysOfWeek.includes(wd) && !(s.skipDates ?? []).includes(c.date))).length;
}

type AcceptPv = { key: string; status: "ready"; data: AcceptPreview } | { key: string; status: "error"; error: string };

export function UseDayDialog({ offer, senderName, ownSchedules, onClose, onApplied }: { offer: OfferView; senderName: string; ownSchedules: Schedule[]; onClose: () => void; onApplied: () => void }): ReactElement {
  const tr = useTr();
  const now = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<"weekday" | "date">("weekday");
  const [weekdays, setWeekdays] = useState<number[]>([offer.sourceWeekday]);
  const [date, setDate] = useState(() => nextDateOfWeekday(now, offer.sourceWeekday));
  const [conflict, setConflict] = useState<"replace" | "alongside">("replace");
  const [pv, setPv] = useState<AcceptPv | null>(null);
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const labels = useMemo(() => ({ quiet: tr("Quiet"), closing: tr("Closing") }), [tr]);
  const lane = useMemo(() => snapshotLane(offer.blocks, offer.sourceWeekday, labels), [offer.blocks, offer.sourceWeekday, labels]);
  const sentDay = tr(WEEKDAYS_FULL[offer.sourceWeekday] ?? "Sunday");

  const choice: ApplyChoice | null = useMemo(() => {
    if (mode === "weekday") return weekdays.length > 0 ? { mode: "weekday", weekdays: [...weekdays].sort((a, b) => a - b), conflict } : null;
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? { mode: "date", date, conflict } : null;
  }, [mode, weekdays, date, conflict]);
  const key = choice ? JSON.stringify(choice) : "";

  // what WOULD happen — asked again (a moment after the last change) whenever the choice changes; an older answer never lands over a newer question
  useEffect(() => {
    if (!choice) return;
    let alive = true;
    const t = setTimeout(() => {
      void previewAccept(offer.id, choice).then((r) => {
        if (alive) setPv(r.ok ? { key, status: "ready", data: r.data } : { key, status: "error", error: r.error });
      });
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [offer.id, choice, key]);

  const cur = pv && pv.key === key ? pv : null;
  const data = cur?.status === "ready" ? cur.data : null;
  const own = ownBlocksOn(ownSchedules, choice);
  const cannot = data ? cannotBePlaced(data.skipped) : cannotBePlaced(offer.skipped);
  const today = todayYmd(now);

  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));
  const canUse = !!choice && !!data && data.willPlace.length > 0 && !busy;

  const use = async () => {
    if (!choice || !canUse) return;
    setBusy(true);
    setErr(null);
    const r = await acceptOffer(offer.id, choice);
    if (r.ok) onApplied();
    else { setErr(tr(r.error)); setBusy(false); }
  };

  return (
    <GlassModal
      title="Use this day?"
      subtitle={senderName}
      showInitial
      width={560}
      closeOnBackdrop={!busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sb-wz-btn" onClick={onClose} disabled={busy}>{tr("Cancel")}</button>
          <span className="sb-wz-spacer" />
          <button type="button" className="sb-wz-btn sb-wz-btn--primary" onClick={() => void use()} disabled={!canUse}>{busy ? "…" : tr("Use this")}</button>
        </>
      }
    >
      <div className="cr-sch-dlg">
        <p className="cr-sch-dlg-lead" dir="auto">{tr("{day}'s plan of {branch}", { day: sentDay, branch: senderName })}</p>
        <DayLane blocks={lane} compact label={tr("{day}'s plan as it is now", { day: sentDay })} />

        <div className="cr-sch-seg" role="group" aria-label={tr("When to play it")}>
          <button type="button" className={mode === "weekday" ? "is-on" : ""} aria-pressed={mode === "weekday"} onClick={() => setMode("weekday")}>{tr("Every week")}</button>
          <button type="button" className={mode === "date" ? "is-on" : ""} aria-pressed={mode === "date"} onClick={() => setMode("date")}>{tr("One day only")}</button>
        </div>

        {mode === "weekday" ? (
          <div className="cr-sch-days is-dlg" role="group" aria-label={tr("Day of the week")}>
            {WEEKDAYS_SHORT.map((s, i) => (
              <button key={s} type="button" className={`cr-sch-day${weekdays.includes(i) ? " is-on" : ""}`} aria-pressed={weekdays.includes(i)} aria-label={tr(WEEKDAYS_FULL[i] ?? "Sunday")} onClick={() => toggleDay(i)}>
                {tr(s)}
              </button>
            ))}
          </div>
        ) : (
          <label className="cr-sch-date">
            <span>{tr("Date")}</span>
            <input className="sb-wz-input" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} aria-label={tr("Date")} />
          </label>
        )}
        {!choice ? <p className="cr-sch-hint" dir="auto">{mode === "weekday" ? tr("Choose at least one day.") : tr("Choose a date.")}</p> : null}

        {own > 0 ? (
          <fieldset className="cr-sch-conflict">
            <legend className="cr-sch-conflict-note" dir="auto">
              {own === 1 ? tr("This branch already has 1 block on that day.") : tr("This branch already has {n} blocks on that day.", { n: own })}
            </legend>
            <label className="cr-sch-radio">
              <input type="radio" name="cr-sch-conflict" checked={conflict === "replace"} onChange={() => setConflict("replace")} />
              <span dir="auto"><b>{tr("Replace that day")}</b><small>{tr("Its own blocks are switched off, not deleted.")}</small></span>
            </label>
            <label className="cr-sch-radio">
              <input type="radio" name="cr-sch-conflict" checked={conflict === "alongside"} onChange={() => setConflict("alongside")} />
              <span dir="auto"><b>{tr("Keep both")}</b><small>{tr("The new blocks are added next to what is there.")}</small></span>
            </label>
          </fieldset>
        ) : null}

        <div className="cr-sch-will" aria-live="polite">
          <p className="cr-sch-will-title">{tr("What will happen")}</p>
          {!choice ? null : !cur ? (
            <p className="cr-sch-quiet"><span className="cr-sch-spin" role="status" aria-label={tr("Loading")} /></p>
          ) : cur.status === "error" ? (
            <p className="cr-sch-err" role="alert">{tr(cur.error)}</p>
          ) : (
            <ul className="cr-sch-will-list" dir="auto">
              <li>{data!.willPlace.length === 1 ? tr("1 block will be added.") : tr("{n} blocks will be added.", { n: data!.willPlace.length })}</li>
              {data!.replaced.length > 0 ? <li>{data!.replaced.length === 1 ? tr("1 of this branch's own blocks will be switched off for that day.") : tr("{n} of this branch's own blocks will be switched off for that day.", { n: data!.replaced.length })}</li> : null}
              {data!.ties.length > 0 ? <li>{data!.ties.length === 1 ? tr("1 block starts at the same minute as one already there.") : tr("{n} blocks start at the same minute as one already there.", { n: data!.ties.length })}</li> : null}
              {cannot.length > 0 ? (
                <li>
                  {cannot.length === 1 ? tr("1 can't be placed") : tr("{n} can't be placed", { n: cannot.length })}{" "}
                  <button type="button" className="cr-sch-link" aria-expanded={why} onClick={() => setWhy((v) => !v)}>{why ? tr("Hide") : tr("Show why")}</button>
                </li>
              ) : null}
              {data!.warnings.some((w) => w.code === "today") ? <li className="is-warn">{tr("This starts today. A block whose time has passed will not start.")}</li> : null}
            </ul>
          )}
          {why && cannot.length > 0 ? <WhyList skipped={cannot} tr={tr} /> : null}
        </div>
        {err ? <p className="cr-sch-err" role="alert">{err}</p> : null}
      </div>
    </GlassModal>
  );
}
