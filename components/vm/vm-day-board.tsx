"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useLocale } from "@/lib/locale-context";
import { useTr } from "@/lib/i18n/use-tr";
import { buildDayScenes, formatMinutes, nowAndNext, weekDatesFor, DAY_MINUTES, type Scene } from "@/lib/schedules-timeline";
import type { Schedule } from "@/lib/types";
import { playlistSeconds } from "@/components/vm/vm-source-row";
import { PX_PER_MIN, boardLayout, dateKey, pad2, parseDateKey, shiftDay } from "@/lib/day-board";
import { IconChevronBack, IconChevronForward, IconUpNext } from "@/components/vm/vm-icons";

/**
 * THE DAY BOARD (owner 2026-11-18: "I want to see a real daily board — the day's schedule — and to change the date when I press on it"). The day of the OPEN branch as a timeline: the hours down the side,
 * every block as a soft bar where it starts and as long as it lasts, the block that is on now lifted, a thin line where the time is now. The date on top: arrows for the day before / after, a press on the
 * date opens the phone's own date picker. Read only — the plan is made on the computer (Schedules). The blocks are the Schedules Studio's own (`buildDayScenes`), so the phone and the computer never
 * disagree about what plays when.
 */

/** the schedules of one branch (re-read when the app comes back to the front: the plan may have been changed on the computer) */
function useBranchSchedules(branchId: string | null): { schedules: Schedule[] | null; status: "loading" | "ready" | "error" } {
  const [res, setRes] = useState<{ branch: string | null; schedules: Schedule[] | null; status: "loading" | "ready" | "error" }>({ branch: null, schedules: null, status: "loading" });
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
  }, [branchId]);
  return res.branch === branchId ? { schedules: res.schedules, status: res.status } : { schedules: null, status: "loading" };
}

export function VmDayBoard({ branchId }: { branchId: string | null }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { sources } = useMobileSources();
  const { schedules, status } = useBranchSchedules(branchId);
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
    return buildDayScenes(schedules, day.getDay(), weekDatesFor(day), musicMinutes).filter((s) => !s.paused && !s.shadowed);
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
              const past = isToday && sc.end <= nowMin && !isNow;
              const until = sc.end >= DAY_MINUTES - 1 ? "" : `${formatMinutes(sc.start)}–${formatMinutes(sc.end)}`;
              return (
                <div key={`${sc.schedule.id}:${sc.start}`} className="vm-day-blk" data-now={isToday && isNow ? "" : undefined} data-quiet={sc.quiet ? "" : undefined} data-past={past ? "" : undefined} data-short={height < 46 ? "" : undefined} style={{ top, height }}>
                  <span className="vm-day-name vm-bdi">{nameOf(sc)}</span>
                  <span className="vm-day-time">
                    <bdi dir="ltr">{until || formatMinutes(sc.start)}</bdi>
                    {isToday && isNext ? ` · ${tr("Next")}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
