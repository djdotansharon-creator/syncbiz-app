"use client";

/**
 * CONTROL ROOM — the SCHEDULE of one branch, and "send a day to my other branches" (owner 2026-11-25, phase 2: the screens; the server is phase 1).
 *
 * On the branch screen, between the devices and the jingles:
 *   · a small READ-ONLY lane of one day (Sun–Sat chips, today first) — it reads the branch's schedule (GET /api/schedules?branchId=) and draws it with the Studio's own pure helpers
 *     (lib/branch-schedule-lane.ts → buildDayScenes). Nothing here can be edited, dragged or saved. There is no history: "Tuesday's plan as it is now".
 *   · OWNER only: "Send this day to…" (a dialog with a checklist and a dry run). The server refuses anyone else; hiding the button is only a courtesy.
 *   · UNDO: "Applied from <branch> — Undo" stays for 14 days; it says what was removed and what was left because it was edited since.
 *   · one calm line after the offer screen returned ("Done. 3 blocks added from …" / "Closed. … can send it again.").
 * A day that ANOTHER branch sent is not shown here: it is a notification under the branch title and its own screen (branch-schedule-offer.tsx).
 * The send window is in branch-schedule-dialogs.tsx; every call to the server is in lib/schedule-day-share-client.ts. Styles: branch-schedule.css (the look tokens of the Control Room — no colours of its own).
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { useLocale } from "@/lib/locale-context";
import { WEEKDAYS_FULL, WEEKDAYS_SHORT, laneBlocks, undoableOffers } from "@/lib/branch-schedule-lane";
import { listOffers, undoOffer, type OfferView, type UndoResult } from "@/lib/schedule-day-share-client";
import { SendDayDialog } from "@/components/control-room/branch-schedule-dialogs";
import { DayLane, useBranches } from "@/components/control-room/branch-schedule-parts";
import { Spinner, clearScheduleNotice, peekScheduleNotice, useBranchSchedules, usePlaylists } from "@/components/control-room/branch-schedule-data";
import "./branch-schedule.css";

type AcceptedState = { branchId: string; accepted: OfferView[] };

/** the accepted offers of this branch (the Undo rows) */
function useAcceptedOffers(branchId: string, tick: number): AcceptedState | null {
  const [state, setState] = useState<AcceptedState | null>(null);
  useEffect(() => {
    let alive = true;
    void listOffers({ branchId, status: "accepted" }).then((a) => {
      if (!alive) return;
      setState({ branchId, accepted: a.ok ? [...a.data].sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime()) : [] });
    });
    return () => { alive = false; };
  }, [branchId, tick]);
  return state && state.branchId === branchId ? state : null;
}

/** how many offers wait for each branch (one request for the whole list) — the small dot on a branch row; `refresh` after someone answered */
export function useWaitingDayOffers(): { counts: Record<string, number>; refresh: () => void } {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void listOffers({ status: "pending" }).then((r) => {
      if (!alive || !r.ok) return;
      const m: Record<string, number> = {};
      for (const o of r.data) m[o.targetBranchId] = (m[o.targetBranchId] ?? 0) + 1;
      setCounts(m);
    });
    return () => { alive = false; };
  }, [tick]);
  useEffect(() => {
    const on = () => { if (document.visibilityState === "visible") setTick((t) => t + 1); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { counts, refresh };
}

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Every Tuesday" / "Every Sunday, Tuesday" / "On 3 Dec" — how an applied offer reads */
function useAppliedText(): (a: NonNullable<OfferView["applied"]>) => string {
  const tr = useTr();
  const { locale } = useLocale();
  return (a) => {
    if (a.mode === "date" && a.date) {
      const [y, m, d] = a.date.split("-").map(Number) as [number, number, number];
      const text = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "long", day: "numeric", month: "short" }).format(new Date(y, m - 1, d));
      return tr("On {date}", { date: text });
    }
    if (a.weekdays.length >= 7) return tr("Every day");
    return tr("Every {days}", { days: a.weekdays.map((w) => tr(WEEKDAYS_FULL[w] ?? "Sunday")).join(", ") });
  };
}

function undoSummary(u: UndoResult, tr: ReturnType<typeof useTr>): string[] {
  const out: string[] = [];
  out.push(u.removed === 1 ? tr("1 block removed.") : tr("{n} blocks removed.", { n: u.removed }));
  if (u.restored > 0) out.push(u.restored === 1 ? tr("1 of this branch's own blocks is back.") : tr("{n} of this branch's own blocks are back.", { n: u.restored }));
  if (u.leftInPlace.length > 0) out.push(u.leftInPlace.length === 1 ? tr("1 block stayed, because it was changed since.") : tr("{n} blocks stayed, because they were changed since.", { n: u.leftInPlace.length }));
  if (u.notRestored.length > 0) out.push(u.notRestored.length === 1 ? tr("1 of this branch's own blocks was not put back, because it was changed since.") : tr("{n} of this branch's own blocks were not put back, because they were changed since.", { n: u.notRestored.length }));
  return out;
}

// ── the section ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function BranchSchedule({ branchId, branchName, isOwner, onChanged }: { branchId: string; branchName: string; /** the owner of the business (the send API refuses anyone else — this only decides whether the button is drawn) */ isOwner: boolean; /** an offer for this branch was undone — the branch list refreshes its dots */ onChanged?: () => void }): ReactElement {
  const tr = useTr();
  const appliedText = useAppliedText();
  const [day, setDay] = useState(() => new Date().getDay());
  const [tick, setTick] = useState(0);
  const { state: sched, loading } = useBranchSchedules(branchId, tick);
  const playlists = usePlaylists();
  const offers = useAcceptedOffers(branchId, tick);
  const branches = useBranches();
  const [sending, setSending] = useState(false);
  const [undone, setUndone] = useState<Record<string, UndoResult>>({});
  const [undoBusy, setUndoBusy] = useState<string | null>(null);
  const [undoErr, setUndoErr] = useState<Record<string, string>>({});
  // the calm line the offer screen left for this branch ("Done …" / "Closed …"): shown once, for a little while
  const [notice, setNotice] = useState<string | null>(() => peekScheduleNotice(branchId));
  useEffect(() => {
    clearScheduleNotice(branchId);
    const t = setTimeout(() => setNotice(null), 14_000);
    return () => clearTimeout(t);
  }, [branchId]);
  const today = new Date().getDay();
  const nameOfBranch = useCallback((id: string) => branches?.find((b) => b.id === id)?.name ?? tr("Another branch"), [branches, tr]);

  const labels = useMemo(() => ({ quiet: tr("Quiet"), closing: tr("Closing") }), [tr]);
  const items = sched?.items;
  const lane = useMemo(
    () => (items ? laneBlocks(items, day, (s) => playlists?.get(s.targetId)?.name ?? (s.name ?? "").trim(), labels) : []),
    [items, day, labels, playlists],
  );

  const dayName = tr(WEEKDAYS_FULL[day] ?? "Sunday");
  const applied = offers ? undoableOffers(offers.accepted, new Date()) : [];
  const appliedShown = applied.filter((o) => !undone[o.id]);
  const undoneNow = Object.entries(undone);

  const undo = async (o: OfferView) => {
    if (undoBusy) return;
    setUndoBusy(o.id);
    setUndoErr((m) => { const n = { ...m }; delete n[o.id]; return n; });
    const r = await undoOffer(o.id);
    setUndoBusy(null);
    if (r.ok) {
      setUndone((m) => ({ ...m, [o.id]: r.data }));
      setTick((t) => t + 1);
      onChanged?.();
    } else {
      setUndoErr((m) => ({ ...m, [o.id]: tr(r.error) }));
    }
  };

  return (
    <section className="cr-bp-sec cr-sch" aria-label={tr("Schedule")}>
      <div className="cr-sch-head">
        <h3 className="cr-bp-title">{tr("Schedule")}</h3>
        {sched && sched.status === "ready" && !sched.enabled ? <span className="cr-sch-off" title={tr("The player is not following its schedule.")}>{tr("Schedule: Off")}</span> : null}
      </div>

      {notice ? <p className="cr-sch-notice" role="status" dir="auto">{notice}</p> : null}

      <div className="cr-sch-days" role="group" aria-label={tr("Day of the week")}>
        {WEEKDAYS_SHORT.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`cr-sch-day${i === day ? " is-on" : ""}${i === today ? " is-today" : ""}`}
            aria-pressed={i === day}
            aria-label={`${tr(WEEKDAYS_FULL[i] ?? "Sunday")}${i === today ? `, ${tr("Today")}` : ""}`}
            onClick={() => setDay(i)}
          >
            {tr(s)}
            <i className="cr-sch-day-dot" aria-hidden />
          </button>
        ))}
      </div>

      <div className="cr-sch-bar">
        <p className="cr-sch-note" dir="auto">{tr("{day}'s plan as it is now", { day: dayName })}</p>
        {isOwner ? (
          <button
            type="button"
            className="cr-sch-btn"
            disabled={lane.length === 0}
            title={lane.length === 0 ? tr("Nothing planned on this day.") : undefined}
            onClick={() => setSending(true)}
          >
            {tr("Send this day to…")}
          </button>
        ) : null}
      </div>

      {sched === null && loading ? (
        <p className="cr-sch-quiet"><Spinner label={tr("Loading")} /></p>
      ) : sched?.status === "error" ? (
        <p className="cr-sch-quiet">
          {tr("Can't load the schedule.")} <button type="button" className="cr-sch-link" onClick={() => setTick((t) => t + 1)}>{tr("Try again")}</button>
        </p>
      ) : lane.length === 0 ? (
        <p className="cr-sch-quiet">{tr("Nothing planned on this day.")}</p>
      ) : (
        <DayLane blocks={lane} label={tr("{day}'s plan as it is now", { day: dayName })} />
      )}

      {appliedShown.length > 0 || undoneNow.length > 0 ? (
        <ul className="cr-sch-applied">
          {appliedShown.map((o) => (
            <li key={o.id} className="cr-sch-applied-row">
              <span className="cr-sch-applied-txt" dir="auto">
                <b>{tr("Applied from {branch}", { branch: nameOfBranch(o.fromBranchId) })}</b>
                <small>
                  {o.applied ? appliedText(o.applied) : ""}
                  {o.result ? ` · ${o.result.created.length === 1 ? tr("1 block added") : tr("{n} blocks added", { n: o.result.created.length })}` : ""}
                </small>
                {undoErr[o.id] ? <small className="cr-sch-err" role="alert">{undoErr[o.id]}</small> : null}
              </span>
              <button type="button" className="cr-sch-btn" onClick={() => void undo(o)} disabled={undoBusy !== null} title={tr("Go back to how it was before")}>
                {undoBusy === o.id ? <Spinner label={tr("Loading")} /> : tr("Undo")}
              </button>
            </li>
          ))}
          {undoneNow.map(([id, u]) => (
            <li key={id} className="cr-sch-applied-row is-undone">
              <span className="cr-sch-applied-txt" dir="auto" role="status">
                <b>{tr("Undone")}</b>
                <small>{undoSummary(u, tr).join(" ")}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {sending ? <SendDayDialog fromBranchId={branchId} fromName={branchName} weekday={day} onClose={() => setSending(false)} /> : null}
    </section>
  );
}
