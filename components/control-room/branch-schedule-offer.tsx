"use client";

/**
 * CONTROL ROOM — a day of a schedule that ANOTHER branch sent to this one (owner 2026-11-25, phase 2, reworked after the owner's feedback: "it must be a NOTIFICATION; if I open it a NEW SCREEN opens, all the buttons fly
 * away, only the branch title stays, under it 'Schedule' and the day displayed with the songs, as we know it").
 *   · SchedulePill — the NOTIFICATION: one calm line under the branch title ("A schedule is waiting · from <branch>", a count when several). No box, no strip. Pressing it opens the offer screen.
 *   · BranchOfferScreen — the OFFER SCREEN. It takes the place of the whole branch screen (like the people screen does): a back arrow and the branch's logo + name — nothing else. Under them "Schedule" and the day the
 *     way the Schedules Studio shows one: the day lane of blocks with the playlist COVERS, the name and the times (quiet blocks hatched), and "The day, hour by hour" with a cover on every row. Under that: what can't be
 *     placed (and why), a calm note when the branch already has blocks that day, the choice of day (a weekly routine — the day that was sent unless changed — or ONE date, not in the past), "Replace that day" (default)
 *     or "Keep both", "What will happen" (a dry run, written before anything is), and [Use this] / [Not now]. Both answers return to the branch screen with one calm line; "Applied from … — Undo" stays there for 14 days.
 * The Studio's own code is not used (only its pure helpers, lib/schedules-timeline.ts): the look is recreated in branch-schedule.css. The covers come from the playlists the workspace already lists (GET /api/playlists, by
 * target id); a block with no cover gets the Studio's placeholder. Nothing here edits a schedule directly: the only writes are the server's own answer (accept / decline).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import type { Schedule } from "@/lib/types";
import { LogoTile } from "@/components/control-room/logo-tile";
import { formatMinutes, tickStep, windowTicks } from "@/lib/schedules-timeline";
import {
  WEEKDAYS_FULL,
  WEEKDAYS_SHORT,
  cannotBePlaced,
  laneBox,
  laneRange,
  laneTimes,
  nextDateOfWeekday,
  ownBlocksOn,
  snapshotLane,
  todayYmd,
  type LaneBlock,
} from "@/lib/branch-schedule-lane";
import { acceptOffer, declineOffer, listOffers, previewAccept, type AcceptPreview, type ApplyChoice, type OfferView } from "@/lib/schedule-day-share-client";
import { WhyList, useBranches, useWidth } from "@/components/control-room/branch-schedule-parts";
import { Spinner, postScheduleNotice, useBranchSchedules, usePlaylists, type PlaylistInfo } from "@/components/control-room/branch-schedule-data";
import "./branch-schedule.css";

const newestFirst = (xs: OfferView[]): OfferView[] => [...xs].sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());

// ── the notification ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** the one calm line under the branch title — nothing at all when no schedule is waiting */
export function SchedulePill({ branchId, onOpen }: { branchId: string; onOpen: () => void }): ReactElement | null {
  const tr = useTr();
  const branches = useBranches();
  const [got, setGot] = useState<{ branchId: string; list: OfferView[] } | null>(null);
  useEffect(() => {
    let alive = true;
    void listOffers({ branchId, status: "pending" }).then((r) => { if (alive) setGot({ branchId, list: r.ok ? newestFirst(r.data) : [] }); });
    return () => { alive = false; };
  }, [branchId]);
  const list = got && got.branchId === branchId ? got.list : [];
  if (list.length === 0) return null;
  const from = branches?.find((b) => b.id === list[0]!.fromBranchId)?.name ?? tr("Another branch");
  const text = list.length === 1 ? tr("A schedule is waiting · from {branch}", { branch: from }) : tr("Schedules are waiting");
  return (
    <div className="cr-sch-pill-row">
      <button type="button" className="cr-sch-pill" onClick={onOpen} aria-label={text}>
        <i className="cr-sch-dot" aria-hidden />
        <span className="cr-sch-pill-text" dir="auto">{text}</span>
        {list.length > 1 ? <span className="cr-sch-count">{list.length}</span> : null}
        <svg className="cr-sch-pill-go rtl:rotate-180" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
      </button>
    </div>
  );
}

// ── the day, the way the Studio shows it ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function NoteIcon(): ReactElement {
  return (
    <svg className="cr-sch-note-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </svg>
  );
}

/** the picture of a block: the playlist's cover, the Studio's hatched placeholder when it has none, a quiet hatch for a quiet block */
function Art({ b, cover }: { b: LaneBlock; cover: string | null }): ReactElement {
  const [bad, setBad] = useState<string | null>(null);
  if (b.quiet) return <span className="cr-sch-art is-quiet" aria-hidden />;
  if (cover && bad !== cover) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="cr-sch-art" src={cover} alt="" draggable={false} loading="lazy" onError={() => setBad(cover)} />;
  }
  return <span className="cr-sch-art is-ph" data-tone={b.tone} aria-hidden><NoteIcon /></span>;
}

const coverOf = (b: LaneBlock, playlists: Map<string, PlaylistInfo> | null): string | null => (b.targetType === "PLAYLIST" ? playlists?.get(b.targetId)?.cover ?? null : null);

/** the day lane: blocks with their covers, names and times across the day (a block too short for its words keeps only the picture — the list under it says everything) */
function StudioDay({ blocks, playlists, label }: { blocks: LaneBlock[]; playlists: Map<string, PlaylistInfo> | null; label: string }): ReactElement {
  const tr = useTr();
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const range = useMemo(() => laneRange(blocks), [blocks]);
  const span = Math.max(1, range.last - range.first);
  const ticks = useMemo(() => windowTicks({ a: range.first, b: range.last }, tickStep(width / span, 50)), [range, width, span]);
  return (
    <div className="cr-sch-sd" dir="ltr">
      <div ref={ref} className="cr-sch-sd-track" role="list" aria-label={label}>
        {ticks.map((m) => (
          <i key={m} className="cr-sch-grid" style={{ insetInlineStart: `${((m - range.first) / span) * 100}%` }} aria-hidden />
        ))}
        {blocks.map((b) => {
          const box = laneBox(b, range);
          const px = (box.width / 100) * width;
          const name = b.name || tr("Music");
          return (
            <div
              key={b.key}
              role="listitem"
              className={`cr-sch-sd-b${b.quiet ? " is-quiet" : ""}${b.closing ? " is-closing" : ""}`}
              style={{ insetInlineStart: `calc(${box.left}% + 2px)`, width: `calc(${box.width}% - 4px)` }}
              title={`${laneTimes(b)} · ${name}`}
              aria-label={`${name}, ${laneTimes(b)}`}
            >
              <Art b={b} cover={coverOf(b, playlists)} />
              {px < 70 ? null : (
                <span className="cr-sch-sd-text">
                  <span className="cr-sch-sd-name">{name}</span>
                  {px < 104 ? null : <span className="cr-sch-sd-time">{laneTimes(b)}</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="cr-sch-axis" aria-hidden>
        {ticks.map((m) => (
          <span key={m} style={{ insetInlineStart: `${((m - range.first) / span) * 100}%` }}>{formatMinutes(m)}</span>
        ))}
      </div>
    </div>
  );
}

/** "The day, hour by hour": a row for every block — times, cover, name */
function Agenda({ blocks, playlists }: { blocks: LaneBlock[]; playlists: Map<string, PlaylistInfo> | null }): ReactElement {
  const tr = useTr();
  return (
    <ul className="cr-sch-ag" aria-label={tr("The day, hour by hour")}>
      {blocks.map((b) => (
        <li key={b.key} className={`cr-sch-ag-row${b.quiet ? " is-quiet" : ""}`}>
          <span className="cr-sch-ag-time" dir="ltr">{laneTimes(b)}</span>
          <Art b={b} cover={coverOf(b, playlists)} />
          <span className="cr-sch-ag-name"><bdi>{b.name || tr("Music")}</bdi></span>
        </li>
      ))}
    </ul>
  );
}

// ── the offer screen ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** which days a choice lands on (not the way conflicts are handled) — the note about blocks already there belongs to these days */
const dayKeyOf = (c: ApplyChoice): string => (c.mode === "weekday" ? `w:${[...c.weekdays].sort((a, b) => a - b).join(",")}` : `d:${c.date}`);

type AcceptPv = { key: string; status: "ready"; data: AcceptPreview } | { key: string; status: "error"; error: string };

function OfferBody({ branchId, offer, senderName, playlists, ownItems, onBack, onChanged }: { branchId: string; offer: OfferView; senderName: string; playlists: Map<string, PlaylistInfo> | null; ownItems: Schedule[]; onBack: () => void; onChanged: () => void }): ReactElement {
  const tr = useTr();
  const now = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<"weekday" | "date">("weekday");
  const [weekdays, setWeekdays] = useState<number[]>([offer.sourceWeekday]);
  const [date, setDate] = useState(() => nextDateOfWeekday(now, offer.sourceWeekday));
  const [conflict, setConflict] = useState<"replace" | "alongside">("replace");
  const [pv, setPv] = useState<AcceptPv | null>(null);
  const [seenKey, setSeenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"use" | "no" | null>(null);
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
        if (!alive) return;
        setPv(r.ok ? { key, status: "ready", data: r.data } : { key, status: "error", error: r.error });
        // the server says "this branch already has blocks that day" (what it would switch off, or same-minute ties) — the note stays while those days are chosen, whichever of the two ways is picked
        if (r.ok && (r.data.replaced.length > 0 || r.data.ties.length > 0)) setSeenKey(dayKeyOf(choice));
      });
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [offer.id, choice, key]);

  const cur = pv && pv.key === key ? pv : null;
  const data = cur?.status === "ready" ? cur.data : null;
  // does this branch already have blocks on the days chosen? Its own rows (exact branch) tell at once; the server's dry run confirms (it also knows a branch whose rows carry the old "default" id)
  const hasOwn = ownBlocksOn(ownItems.filter((s) => s.branchId === branchId), choice) > 0 || (!!choice && seenKey === dayKeyOf(choice));
  const cannot = data ? cannotBePlaced(data.skipped) : cannotBePlaced(offer.skipped);
  const today = todayYmd(now);
  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));
  const canUse = !!choice && !!data && data.willPlace.length > 0 && busy === null;

  const use = async () => {
    if (!choice || !canUse) return;
    setBusy("use");
    setErr(null);
    const r = await acceptOffer(offer.id, choice);
    if (r.ok) {
      const n = r.data.created.length;
      postScheduleNotice(branchId, n === 1 ? tr("Done. 1 block added from {branch}.", { branch: senderName }) : tr("Done. {n} blocks added from {branch}.", { n, branch: senderName }));
      onChanged();
      onBack();
    } else {
      setErr(tr(r.error));
      setBusy(null);
    }
  };
  const notNow = async () => {
    if (busy) return;
    setBusy("no");
    setErr(null);
    const r = await declineOffer(offer.id);
    if (r.ok) {
      postScheduleNotice(branchId, tr("Closed. {branch} can send it again.", { branch: senderName }));
      onChanged();
      onBack();
    } else {
      setErr(tr(r.error));
      setBusy(null);
    }
  };

  return (
    <>
      <p className="cr-sch-os-from" dir="auto">{tr("{branch} sent its {day} plan", { branch: senderName, day: sentDay })}</p>
      <StudioDay blocks={lane} playlists={playlists} label={tr("{day}'s plan as it is now", { day: sentDay })} />

      <h4 className="cr-sch-os-sub">{tr("The day, hour by hour")}</h4>
      <Agenda blocks={lane} playlists={playlists} />

      {cannot.length > 0 ? (
        <section className="cr-sch-os-sec">
          <h4 className="cr-sch-os-sub">{cannot.length === 1 ? tr("1 can't be placed") : tr("{n} can't be placed", { n: cannot.length })}</h4>
          <WhyList skipped={cannot} />
        </section>
      ) : null}

      <section className="cr-sch-os-sec">
        <h4 className="cr-sch-os-sub">{tr("When to play it")}</h4>
        <div className="cr-sch-seg" role="group" aria-label={tr("When to play it")}>
          <button type="button" className={mode === "weekday" ? "is-on" : ""} aria-pressed={mode === "weekday"} onClick={() => setMode("weekday")}>{tr("Every week")}</button>
          <button type="button" className={mode === "date" ? "is-on" : ""} aria-pressed={mode === "date"} onClick={() => setMode("date")}>{tr("One day only")}</button>
        </div>
        {mode === "weekday" ? (
          <div className="cr-sch-days is-os" role="group" aria-label={tr("Day of the week")}>
            {WEEKDAYS_SHORT.map((s, i) => (
              <button key={s} type="button" className={`cr-sch-day${weekdays.includes(i) ? " is-on" : ""}`} aria-pressed={weekdays.includes(i)} aria-label={tr(WEEKDAYS_FULL[i] ?? "Sunday")} onClick={() => toggleDay(i)}>
                {tr(s)}
              </button>
            ))}
          </div>
        ) : (
          <label className="cr-sch-date">
            <span>{tr("Date")}</span>
            <input className="cr-sch-date-in" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} aria-label={tr("Date")} />
          </label>
        )}
        {!choice ? <p className="cr-sch-hint" dir="auto">{mode === "weekday" ? tr("Choose at least one day.") : tr("Choose a date.")}</p> : null}
      </section>

      {hasOwn ? (
        <fieldset className="cr-sch-conflict">
          <legend className="cr-sch-conflict-note" dir="auto">{tr("This branch already has blocks on that day.")}</legend>
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

      <section className="cr-sch-os-sec cr-sch-will" aria-live="polite">
        <h4 className="cr-sch-os-sub">{tr("What will happen")}</h4>
        {!choice ? null : !cur ? (
          <p className="cr-sch-quiet"><Spinner label={tr("Loading")} /></p>
        ) : cur.status === "error" ? (
          <p className="cr-sch-err" role="alert">{tr(cur.error)}</p>
        ) : (
          <ul className="cr-sch-will-list" dir="auto">
            <li>{data!.willPlace.length === 1 ? tr("1 block will be added.") : tr("{n} blocks will be added.", { n: data!.willPlace.length })}</li>
            {data!.replaced.length > 0 ? <li>{data!.replaced.length === 1 ? tr("1 of this branch's own blocks will be switched off for that day.") : tr("{n} of this branch's own blocks will be switched off for that day.", { n: data!.replaced.length })}</li> : null}
            {data!.ties.length > 0 ? <li>{data!.ties.length === 1 ? tr("1 block starts at the same minute as one already there.") : tr("{n} blocks start at the same minute as one already there.", { n: data!.ties.length })}</li> : null}
            {data!.warnings.some((w) => w.code === "today") ? <li className="is-warn">{tr("This starts today. A block whose time has passed will not start.")}</li> : null}
          </ul>
        )}
      </section>
      {err ? <p className="cr-sch-err" role="alert">{err}</p> : null}

      <div className="cr-sch-actions is-os">
        <button type="button" className="cr-sch-btn cr-sch-btn--main" onClick={() => void use()} disabled={!canUse}>{busy === "use" ? "…" : tr("Use this")}</button>
        <button type="button" className="cr-sch-btn" onClick={() => void notNow()} disabled={busy !== null} title={tr("The offer is closed. They can send it again.")}>{busy === "no" ? "…" : tr("Not now")}</button>
      </div>
    </>
  );
}

export function BranchOfferScreen({ branchId, name, brandName, brandColor, logoUrl, onBack, onChanged }: {
  branchId: string;
  name: string;
  brandName?: string | null;
  brandColor?: string | null;
  logoUrl?: string | null;
  /** back to the branch screen (the arrow, Esc, or after an answer) */
  onBack: () => void;
  /** an offer was answered — the branch list refreshes its dots */
  onChanged: () => void;
}): ReactElement {
  const tr = useTr();
  const branches = useBranches();
  const playlists = usePlaylists();
  const { state: own } = useBranchSchedules(branchId, 0);
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState<{ branchId: string; tick: number; list: OfferView[]; ok: boolean } | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let alive = true;
    void listOffers({ branchId, status: "pending" }).then((r) => { if (alive) setLoaded({ branchId, tick, list: r.ok ? newestFirst(r.data) : [], ok: r.ok }); });
    return () => { alive = false; };
  }, [branchId, tick]);
  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onBack(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onBack]);

  const ready = loaded && loaded.branchId === branchId && loaded.tick === tick ? loaded : null;
  const list = ready?.list ?? [];
  const offer = list.find((o) => o.id === pickedId) ?? list[0] ?? null;
  const senderOf = (o: OfferView) => branches?.find((b) => b.id === o.fromBranchId)?.name ?? tr("Another branch");
  const color = brandColor ?? "#8e8e93";
  const initial = ((brandName || name).trim().split(/\s+/).pop() ?? "").charAt(0).toUpperCase();

  return (
    <div className="cr-bp cr-sch-os">
      <header className="cr-bp-head">
        <button type="button" onClick={onBack} className="cr-bp-icon cr-bp-back" aria-label={tr("Back")} title={tr("Back")}>
          <svg className="h-[18px] w-[18px] rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <LogoTile src={logoUrl} color={color} initial={initial} />
        <div className="cr-bp-name">
          <h2 dir="auto">{name}</h2>
        </div>
      </header>
      <div className="cr-sch-os-body">
        <h3 className="cr-sch-os-title" tabIndex={-1} ref={titleRef}>{tr("Schedule")}</h3>
        {ready === null ? (
          <p className="cr-sch-quiet"><Spinner label={tr("Loading")} /></p>
        ) : !ready.ok ? (
          <p className="cr-sch-quiet">{tr("Can't load the schedule.")} <button type="button" className="cr-sch-link" onClick={() => setTick((t) => t + 1)}>{tr("Try again")}</button></p>
        ) : !offer ? (
          <p className="cr-sch-quiet">{tr("No schedule is waiting.")}</p>
        ) : (
          <>
            {list.length > 1 ? (
              <div className="cr-sch-os-pick" role="group" aria-label={tr("Waiting schedules")}>
                {list.map((o) => (
                  <button key={o.id} type="button" className={o.id === offer.id ? "is-on" : ""} aria-pressed={o.id === offer.id} onClick={() => setPickedId(o.id)}>
                    <bdi>{senderOf(o)}</bdi> · {tr(WEEKDAYS_FULL[o.sourceWeekday] ?? "Sunday")}
                  </button>
                ))}
              </div>
            ) : null}
            <OfferBody
              key={offer.id}
              branchId={branchId}
              offer={offer}
              senderName={senderOf(offer)}
              playlists={playlists}
              ownItems={own?.items ?? []}
              onBack={onBack}
              onChanged={onChanged}
            />
          </>
        )}
      </div>
    </div>
  );
}
