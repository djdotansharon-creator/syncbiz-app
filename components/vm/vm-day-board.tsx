"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useLocale } from "@/lib/locale-context";
import { useTr } from "@/lib/i18n/use-tr";
import { buildDayScenes, formatMinutes, nowAndNext, weekDatesFor, DAY_MINUTES, type Scene } from "@/lib/schedules-timeline";
import type { Schedule } from "@/lib/types";
import { playlistSeconds } from "@/components/vm/vm-source-row";
import { PX_PER_MIN, boardLayout, dateKey, pad2, parseDateKey, shiftDay } from "@/lib/day-board";
import { IconChevronBack, IconChevronForward, IconUpNext } from "@/components/vm/vm-icons";
import { useVmUi } from "@/components/vm/vm-ui";
import { isSkippedOn, withSkipDate } from "@/lib/schedule-skip";

/**
 * THE DAY BOARD (owner 2026-11-18: "I want to see a real daily board — the day's schedule — and to change the date when I press on it"). The day of the OPEN branch as a timeline: the hours down the side,
 * every block as a soft bar where it starts and as long as it lasts, the block that is on now lifted, a thin line where the time is now. The date on top: arrows for the day before / after, a press on the
 * date opens the phone's own date picker. Read only — the plan is made on the computer (Schedules). The blocks are the Schedules Studio's own (`buildDayScenes`), so the phone and the computer never
 * disagree about what plays when.
 */

/** the schedules of one branch (re-read when the app comes back to the front: the plan may have been changed on the computer) */
function useBranchSchedules(branchId: string | null): { schedules: Schedule[] | null; status: "loading" | "ready" | "error"; reload: () => void } {
  const [res, setRes] = useState<{ branch: string | null; schedules: Schedule[] | null; status: "loading" | "ready" | "error" }>({ branch: null, schedules: null, status: "loading" });
  const [round, setRound] = useState(0); // a block was switched on / off for a day: read the plan again
  const reload = useCallback(() => setRound((n) => n + 1), []);
  useEffect(() => {
    if (!branchId) return;
    let alive = true;
    const read = () =>
      fetch(`/api/schedules?branchId=${encodeURIComponent(branchId)}`, { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = (await r.json()) as Schedule[];
          if (alive) setRes({ branch: branchId, schedules: Array.isArray(data) ? data : [], status: "ready" });
        })
        .catch(() => {
          if (alive) setRes((s) => (s.branch === branchId && s.status === "ready" ? s : { branch: branchId, schedules: null, status: "error" }));
        });
    void read();
    const onVisible = () => document.visibilityState === "visible" && void read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [branchId, round]);
  return res.branch === branchId ? { schedules: res.schedules, status: res.status, reload } : { schedules: null, status: "loading", reload };
}

/**
 * ONE BLOCK, ONE DAY (the father 2026-11-18: "to switch off only today's 14:00 playlist — an ON / OFF button; then the 8:00 playlist plays on until the 18:00 one"). Opened by pressing a block on the board:
 * its name and time, and the switch "plays on <this day>". Off = the block does not start that day and the block before it plays on until the next block that is on; the block itself and every other day
 * stay exactly as they are. Saved with the same route the computer uses (PATCH /api/schedules/:id — `skipDates`), so the station obeys it at its next look (within 30 s).
 */
function VmBlockSheet({ scene, name, dateStr, dateText, today, onSaved }: { scene: Scene; /** the name the board shows for it */ name: string; dateStr: string; dateText: string; /** the day is today: "Plays today" */ today: boolean; onSaved: () => void }) {
  const tr = useTr();
  const ui = useVmUi();
  const [dates, setDates] = useState<string[]>(scene.schedule.skipDates ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const off = isSkippedOn({ skipDates: dates }, dateStr);
  const sc = scene.schedule;
  // a block that is off for this day is drawn as a marker (its length is not meaningful): only its start time
  const range = scene.offDay || scene.end >= DAY_MINUTES - 1 ? formatMinutes(scene.start) : `${formatMinutes(scene.start)}–${formatMinutes(scene.end)}`;
  const flip = async () => {
    if (busy) return;
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(sc.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ skipDates: withSkipDate(dates, dateStr, !off, dateKey(new Date())) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = (await res.json()) as Schedule;
      setDates(Array.isArray(saved.skipDates) ? saved.skipDates : []);
      onSaved();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="vm-ask">
      <h2 className="vm-bdi">{name}</h2>
      <p><bdi dir="ltr">{range}</bdi></p>
      <button type="button" className="vm-blk-switch" role="switch" aria-checked={!off} onClick={() => void flip()} disabled={busy}>
        <span className="vm-blk-switch-text">
          {today ? tr("Plays today") : tr("Plays on {date}", { date: dateText })}
          <small>{off ? tr("Off — the block before it plays on until the next one") : tr("On — plays at its time")}</small>
        </span>
        <span className="vm-switch" data-on={off ? undefined : ""} data-busy={busy ? "" : undefined} />
      </button>
      {err ? <p className="vm-blk-err">{tr("Couldn't save the change")}</p> : null}
      <button type="button" className="vm-ask-btn" data-main onClick={() => ui.closeSheet()}>
        {tr("Done")}
      </button>
    </div>
  );
}

export function VmDayBoard({ branchId }: { branchId: string | null }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { sources } = useMobileSources();
  const { schedules, status, reload } = useBranchSchedules(branchId);
  const ui = useVmUi();
  const [now, setNow] = useState<Date | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // null = today
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const t0 = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, []);

  const todayKey = now ? dateKey(now) : "";
  const day = useMemo(() => (picked ? parseDateKey(picked) : null) ?? now, [picked, now]);
  const dayKeyStr = day ? dateKey(day) : "";
  const isToday = !!day && dayKeyStr === todayKey;

  const lookup = useMemo(
    () => (s: Schedule) =>
      sources.find((u) => {
        if (s.targetType === "PLAYLIST") return u.origin === "playlist" && (u.playlist?.id === s.targetId || u.id === s.targetId);
        if (s.targetType === "SOURCE") return u.origin === "source" && (u.source?.id === s.targetId || u.id === s.targetId);
        if (s.targetType === "RADIO") return u.origin === "radio" && u.id === s.targetId;
        return false;
      }),
    [sources],
  );

  const scenes: Scene[] = useMemo(() => {
    if (!schedules || !day) return [];
    // how long a block's own music lasts: a block with no end of its own is drawn only that long (the same rule as the computer's timeline)
    const musicMinutes = (s: Schedule): number | null => {
      const u = lookup(s);
      const sec = u?.origin === "playlist" ? playlistSeconds(u.playlist) : null;
      return sec && sec > 0 ? Math.max(1, Math.ceil((sec + 20) / 60)) : null;
    };
    // a block switched off for THIS day only stays on the board (dimmed) so it can be switched on again; a block that is paused for every day is not drawn
    return buildDayScenes(schedules, day.getDay(), weekDatesFor(day), musicMinutes).filter((s) => !s.shadowed && (!s.paused || s.offDay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, dayKeyStr, lookup]);

  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : 0;
  const { now: playingNow, next } = useMemo(() => nowAndNext(scenes, nowMin), [scenes, nowMin]);
  const blocks = useMemo(() => boardLayout(scenes), [scenes]);

  // the board opens where the day is: at the time now (today), or at the first block (another day)
  const focusMin = isToday ? nowMin : (scenes[0]?.start ?? 8 * 60);
  const ready = status === "ready" && scenes.length > 0;
  useEffect(() => {
    const el = boardRef.current;
    if (!el || !ready) return;
    el.scrollTop = Math.max(0, focusMin * PX_PER_MIN - 70);
    // only when the day (or the plan) changes — not at every tick of the clock
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKeyStr, ready]);

  const nameOf = (sc: Scene): string => {
    const own = sc.schedule.name?.trim();
    if (sc.quiet) return own || tr("Quiet");
    return lookup(sc.schedule)?.title || own || tr("Playlist");
  };
  const loc = locale === "he" ? "he-IL" : "en-GB";
  const label = day ? day.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" }) : "";
  const go = (n: number) => {
    if (!day) return;
    const next = dateKey(shiftDay(day, n));
    setPicked(next === todayKey ? null : next);
  };

  return (
    <div className="vm-day">
      <div className="vm-day-nav">
        <button type="button" className="vm-icobtn" onClick={() => go(-1)} aria-label={tr("The day before")}>
          <IconChevronBack className="vm-flip" />
        </button>
        <label className="vm-day-date">
          <span className="vm-bdi">{isToday ? `${tr("Today")} · ${label}` : label}</span>
          <input
            type="date"
            value={dayKeyStr}
            aria-label={tr("Choose a date")}
            onChange={(e) => {
              const v = e.target.value;
              if (v && parseDateKey(v)) setPicked(v === todayKey ? null : v);
            }}
          />
        </label>
        <button type="button" className="vm-icobtn" onClick={() => go(1)} aria-label={tr("The day after")}>
          <IconChevronForward className="vm-flip" />
        </button>
      </div>
      {!isToday && day ? (
        <button type="button" className="vm-day-today" onClick={() => setPicked(null)}>
          {tr("Back to today")}
        </button>
      ) : null}

      {status === "loading" ? (
        <div className="vm-day-empty" aria-busy>…</div>
      ) : status === "error" ? (
        <div className="vm-day-empty">
          <span>{tr("Couldn't load the plan")}</span>
        </div>
      ) : scenes.length === 0 ? (
        <div className="vm-day-empty">
          <IconUpNext />
          <span>{tr("Nothing is planned for this day")}</span>
        </div>
      ) : (
        <div className="vm-day-board" ref={boardRef}>
          <div className="vm-day-grid" style={{ height: DAY_MINUTES * PX_PER_MIN }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="vm-day-h" style={{ top: h * 60 * PX_PER_MIN }}>{`${pad2(h)}:00`}</span>
            ))}
            {isToday ? <i className="vm-day-now" style={{ top: nowMin * PX_PER_MIN }} aria-hidden /> : null}
            {blocks.map(({ scene: sc, top, height }) => {
              const isNow = playingNow === sc;
              const isNext = next === sc;
              const off = !!sc.offDay;
              const past = isToday && sc.end <= nowMin && !isNow && !off;
              const until = sc.end >= DAY_MINUTES - 1 ? "" : `${formatMinutes(sc.start)}–${formatMinutes(sc.end)}`;
              return (
                <button
                  type="button"
                  key={`${sc.schedule.id}:${sc.start}`}
                  className="vm-day-blk"
                  data-now={isToday && isNow ? "" : undefined}
                  data-quiet={sc.quiet ? "" : undefined}
                  data-past={past ? "" : undefined}
                  data-off={off ? "" : undefined}
                  data-short={height < 46 || off ? "" : undefined}
                  style={{ top, height: off ? Math.min(height, 40) : height }}
                  aria-label={`${nameOf(sc)} ${until || formatMinutes(sc.start)}`}
                  onClick={() => ui.openSheet(nameOf(sc), <VmBlockSheet scene={sc} name={nameOf(sc)} dateStr={dayKeyStr} dateText={label} today={isToday} onSaved={reload} />)}
                >
                  <span className="vm-day-name vm-bdi">{nameOf(sc)}</span>
                  <span className="vm-day-time">
                    {off ? tr("Off") : <bdi dir="ltr">{until || formatMinutes(sc.start)}</bdi>}
                    {!off && isToday && isNext ? ` · ${tr("Next")}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
