"use client";

/**
 * CONTROL ROOM — the SCHEDULE of one branch, and "send a day to my other branches" (owner 2026-11-25, phase 2: the screens; the server is phase 1).
 *
 * On the branch screen, between the devices and the jingles:
 *   · a small READ-ONLY lane of one day (Sun–Sat chips, today first) — it reads the branch's schedule (GET /api/schedules?branchId=) and draws it with the Studio's own pure helpers
 *     (lib/branch-schedule-lane.ts → buildDayScenes). Nothing here can be edited, dragged or saved. There is no history: "Tuesday's plan as it is now".
 *   · OWNER only: "Send this day to…" (a dialog with a checklist and a dry run). The server refuses anyone else; hiding the button is only a courtesy.
 *   · the RECEIVING side: "Schedule waiting" at the top of the section — who sent which day, a mini lane, what can't be placed, [Use this] / [Not now]. "Use this" opens a small window:
 *     a weekly routine (the day that was sent, or others) or ONE date, what will happen (a dry run first), then it is applied.
 *   · UNDO: "Applied from <branch> — Undo" stays for 14 days; it says what was removed and what was left because it was edited since.
 * The dialogs are in branch-schedule-dialogs.tsx; every call to the server is in lib/schedule-day-share-client.ts. Styles: branch-schedule.css (the look tokens of the Control Room — no colours of its own).
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { useLocale } from "@/lib/locale-context";
import type { Schedule } from "@/lib/types";
import {
  WEEKDAYS_FULL,
  WEEKDAYS_SHORT,
  cannotBePlaced,
  laneBlocks,
  reasonText,
  snapshotLane,
  undoableOffers,
} from "@/lib/branch-schedule-lane";
import { listOffers, undoOffer, declineOffer, type OfferView, type UndoResult } from "@/lib/schedule-day-share-client";
import { SendDayDialog, UseDayDialog } from "@/components/control-room/branch-schedule-dialogs";
import { DayLane, SHARE_MS, useBranches } from "@/components/control-room/branch-schedule-parts";
import "./branch-schedule.css";

let playlistsShared: { at: number; value: Promise<Map<string, string>> } | null = null;
/** playlist id → name, so a block that plays a playlist is drawn with the playlist's name (as the Studio does) */
function loadPlaylistNames(): Promise<Map<string, string>> {
  if (playlistsShared && Date.now() - playlistsShared.at < SHARE_MS) return playlistsShared.value;
  const value = (async (): Promise<Map<string, string>> => {
    const m = new Map<string, string>();
    try {
      const r = await fetch("/api/playlists", { credentials: "include", cache: "no-store" });
      if (!r.ok) return m;
      const j = (await r.json()) as unknown;
      if (Array.isArray(j)) for (const p of j as { id?: unknown; name?: unknown }[]) if (typeof p?.id === "string" && typeof p?.name === "string") m.set(p.id, p.name);
    } catch {
      /* names are a courtesy — the lane falls back to the block's own name */
    }
    return m;
  })();
  playlistsShared = { at: Date.now(), value };
  return value;
}

type SchedState = { branchId: string; status: "ready" | "error"; items: Schedule[]; enabled: boolean; names: Map<string, string> };

/** the branch's schedule blocks + its schedule switch (the `X-Schedule-Enabled` header the same request carries); null = loading the first time */
function useBranchSchedules(branchId: string, tick: number): { state: SchedState | null; loading: boolean } {
  const [state, setState] = useState<SchedState | null>(null);
  const [doneKey, setDoneKey] = useState("");
  const key = `${branchId}:${tick}`;
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [r, names] = await Promise.all([fetch(`/api/schedules?branchId=${encodeURIComponent(branchId)}`, { credentials: "include", cache: "no-store" }), loadPlaylistNames()]);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as unknown;
        if (alive) setState({ branchId, status: "ready", items: Array.isArray(j) ? (j as Schedule[]) : [], enabled: r.headers.get("X-Schedule-Enabled") !== "0", names });
      } catch {
        if (alive) setState({ branchId, status: "error", items: [], enabled: true, names: new Map() });
      } finally {
        if (alive) setDoneKey(key);
      }
    })();
    return () => { alive = false; };
  }, [branchId, key]);
  return { state: state && state.branchId === branchId ? state : null, loading: doneKey !== key };
}

type OffersState = { branchId: string; pending: OfferView[]; accepted: OfferView[]; error: boolean };

/** the offers of this branch: waiting ones, and accepted ones (the Undo rows) */
function useBranchOffers(branchId: string, tick: number): { state: OffersState | null } {
  const [state, setState] = useState<OffersState | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [p, a] = await Promise.all([listOffers({ branchId, status: "pending" }), listOffers({ branchId, status: "accepted" })]);
      if (!alive) return;
      const newest = (xs: OfferView[]) => [...xs].sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
      setState({ branchId, pending: p.ok ? newest(p.data) : [], accepted: a.ok ? newest(a.data) : [], error: !p.ok });
    })();
    return () => { alive = false; };
  }, [branchId, tick]);
  return { state: state && state.branchId === branchId ? state : null };
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

function Spinner({ label }: { label: string }): ReactElement {
  return <span className="cr-sch-spin" role="status" aria-label={label} />;
}

// ── a waiting offer ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function OfferCard({ offer, senderName, ownBlocksThatDay, onUse, onDeclined }: { offer: OfferView; senderName: string; ownBlocksThatDay: number; onUse: () => void; onDeclined: () => void }): ReactElement {
  const tr = useTr();
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const labels = useMemo(() => ({ quiet: tr("Quiet"), closing: tr("Closing") }), [tr]);
  const lane = useMemo(() => snapshotLane(offer.blocks, offer.sourceWeekday, labels), [offer.blocks, offer.sourceWeekday, labels]);
  const cannot = cannotBePlaced(offer.skipped);
  const day = tr(WEEKDAYS_FULL[offer.sourceWeekday] ?? "Sunday");
  const notNow = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const r = await declineOffer(offer.id);
    if (r.ok) onDeclined();
    else { setErr(tr(r.error)); setBusy(false); }
  };
  return (
    <article className="cr-sch-offer" aria-label={tr("{branch} sent its {day} plan", { branch: senderName, day })}>
      <p className="cr-sch-offer-head" dir="auto">{tr("{branch} sent its {day} plan", { branch: senderName, day })}</p>
      <DayLane blocks={lane} compact label={tr("{day}'s plan as it is now", { day })} />
      <p className="cr-sch-offer-meta" dir="auto">
        {offer.summary.fits === 1 ? tr("1 block fits") : tr("{n} blocks fit", { n: offer.summary.fits })}
        {cannot.length > 0 ? (
          <>
            {" · "}
            <button type="button" className="cr-sch-link" aria-expanded={why} onClick={() => setWhy((v) => !v)}>
              {cannot.length === 1 ? tr("1 can't be placed") : tr("{n} can't be placed", { n: cannot.length })}
            </button>
          </>
        ) : null}
      </p>
      {why ? (
        <ul className="cr-sch-why" dir="auto">
          {cannot.map((s, i) => (
            <li key={i}><bdi className="cr-sch-small-time">{s.time.slice(0, 5)}</bdi> <b dir="auto">{s.targetName ?? s.name ?? tr("Music")}</b> <span>{tr(reasonText(s))}</span></li>
          ))}
        </ul>
      ) : null}
      {ownBlocksThatDay > 0 ? <p className="cr-sch-offer-note" dir="auto">{ownBlocksThatDay === 1 ? tr("This branch already has 1 block on that day. The new day will replace it.") : tr("This branch already has {n} blocks on that day. The new day will replace them.", { n: ownBlocksThatDay })}</p> : null}
      {err ? <p className="cr-sch-err" role="alert">{err}</p> : null}
      <div className="cr-sch-actions">
        <button type="button" className="cr-sch-btn cr-sch-btn--main" onClick={onUse} disabled={busy}>{tr("Use this")}</button>
        <button type="button" className="cr-sch-btn" onClick={() => void notNow()} disabled={busy} title={tr("The offer is closed. They can send it again.")}>{tr("Not now")}</button>
      </div>
    </article>
  );
}

// ── the section ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function BranchSchedule({ branchId, branchName, isOwner, onChanged }: { branchId: string; branchName: string; /** the owner of the business (the send API refuses anyone else — this only decides whether the button is drawn) */ isOwner: boolean; /** an offer for this branch was answered or undone — the branch list refreshes its dots */ onChanged?: () => void }): ReactElement {
  const tr = useTr();
  const appliedText = useAppliedText();
  const [day, setDay] = useState(() => new Date().getDay());
  const [tick, setTick] = useState(0);
  const { state: sched, loading } = useBranchSchedules(branchId, tick);
  const { state: offers } = useBranchOffers(branchId, tick);
  const branches = useBranches();
  const [sending, setSending] = useState(false);
  const [using, setUsing] = useState<OfferView | null>(null);
  const [undone, setUndone] = useState<Record<string, UndoResult>>({});
  const [undoBusy, setUndoBusy] = useState<string | null>(null);
  const [undoErr, setUndoErr] = useState<Record<string, string>>({});
  const today = new Date().getDay();
  const nameOfBranch = useCallback((id: string) => branches?.find((b) => b.id === id)?.name ?? tr("Another branch"), [branches, tr]);
  const reload = useCallback(() => { setTick((t) => t + 1); onChanged?.(); }, [onChanged]);

  const labels = useMemo(() => ({ quiet: tr("Quiet"), closing: tr("Closing") }), [tr]);
  const items = sched?.items;
  const lane = useMemo(
    () => (items ? laneBlocks(items, day, (s) => sched?.names.get(s.targetId) ?? (s.name ?? "").trim(), labels) : []),
    [items, day, labels, sched?.names],
  );
  const ownCountOn = useCallback(
    (weekday: number) => (items ?? []).filter((s) => s.enabled && s.recurrence !== "one_off" && Array.isArray(s.daysOfWeek) && s.daysOfWeek.includes(weekday)).length,
    [items],
  );

  const dayName = tr(WEEKDAYS_FULL[day] ?? "Sunday");
  const waiting = offers?.pending ?? [];
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

      {waiting.length > 0 ? (
        <div className="cr-sch-wait" role="region" aria-label={tr("Schedule waiting")}>
          <p className="cr-sch-wait-title"><i className="cr-sch-dot" aria-hidden />{tr("Schedule waiting")} <span className="cr-sch-count">{waiting.length}</span></p>
          {waiting.map((o) => (
            <OfferCard key={o.id} offer={o} senderName={nameOfBranch(o.fromBranchId)} ownBlocksThatDay={ownCountOn(o.sourceWeekday)} onUse={() => setUsing(o)} onDeclined={reload} />
          ))}
        </div>
      ) : null}

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
      {using ? (
        <UseDayDialog
          offer={using}
          senderName={nameOfBranch(using.fromBranchId)}
          ownSchedules={items ?? []}
          onClose={() => setUsing(null)}
          onApplied={() => { setUsing(null); reload(); }}
        />
      ) : null}
    </section>
  );
}
