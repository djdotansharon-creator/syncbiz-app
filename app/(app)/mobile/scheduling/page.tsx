"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useLocale } from "@/lib/locale-context";
import { useTr } from "@/lib/i18n/use-tr";
import { buildDayScenes, formatMinutes, nowAndNext, weekDatesFor, DAY_MINUTES, type Scene } from "@/lib/schedules-timeline";
import type { Schedule } from "@/lib/types";
import { VmPage } from "@/components/vm/vm-ui";
import { VmCover } from "@/components/vm/vm-parts";
import { VmScheduleSwitchLine } from "@/components/vm/vm-schedule-switch";
import { IconChevronBack, IconUpNext } from "@/components/vm/vm-icons";
import { playlistSeconds, sourceCover } from "@/components/vm/vm-source-row";

/**
 * TODAY'S PLAN (owner 2026-11-17: "did you fix the schedule display?" — before it was only recoloured). The day of the OPEN branch as a calm list, no frames: what starts when and until when,
 * the block that is on now lifted off the screen, the next one marked, quiet times (closing) in a quieter hand. The branch's schedule switch sits on top. Read only: the plan is made on
 * the computer (Schedules). The scenes are the Schedules Studio's own (`buildDayScenes`), so the phone and the computer never disagree about what plays when.
 */
export default function MobileSchedulingPage() {
  const { sources } = useMobileSources();
  const fleet = useMobileFleet();
  const tr = useTr();
  const { locale } = useLocale();
  // the schedule of the branch that is OPEN (a schedule belongs to one branch's player)
  const branchId = fleet.selected?.id ?? null;
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const t0 = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!fleet.loaded) return;
    let alive = true;
    const read = () =>
      fetch(branchId ? `/api/schedules?branchId=${encodeURIComponent(branchId)}` : "/api/schedules", { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = (await r.json()) as Schedule[];
          if (!alive) return;
          setSchedules(Array.isArray(data) ? data : []);
          setStatus("ready");
        })
        .catch(() => {
          if (alive) setStatus((s) => (s === "ready" ? s : "error"));
        });
    void read();
    const onVisible = () => document.visibilityState === "visible" && void read(); // the plan may have been changed on the computer meanwhile
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [branchId, fleet.loaded]);

  const lookup = useMemo(() => {
    const find = (s: Schedule) =>
      sources.find((u) => {
        if (s.targetType === "PLAYLIST") return u.origin === "playlist" && (u.playlist?.id === s.targetId || u.id === s.targetId);
        if (s.targetType === "SOURCE") return u.origin === "source" && (u.source?.id === s.targetId || u.id === s.targetId);
        if (s.targetType === "RADIO") return u.origin === "radio" && u.id === s.targetId;
        return false;
      });
    return find;
  }, [sources]);

  const dayKey = now ? `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}` : "";
  const scenes: Scene[] = useMemo(() => {
    if (!schedules || !now) return [];
    // how long a block's own music lasts: a block with no end of its own is drawn only that long (the same rule as the computer's timeline)
    const musicMinutes = (s: Schedule): number | null => {
      const u = lookup(s);
      const sec = u?.origin === "playlist" ? playlistSeconds(u.playlist) : null;
      return sec && sec > 0 ? Math.max(1, Math.ceil((sec + 20) / 60)) : null;
    };
    return buildDayScenes(schedules, now.getDay(), weekDatesFor(now), musicMinutes).filter((s) => !s.paused && !s.shadowed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, dayKey, lookup]);

  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : 0;
  const { now: playingNow, next } = useMemo(() => nowAndNext(scenes, nowMin), [scenes, nowMin]);

  const dateLabel = now ? now.toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { weekday: "long", day: "numeric", month: "long" }) : "";
  const back = (
    <Link href={branchId ? `/mobile/branch/${encodeURIComponent(branchId)}` : "/mobile/home"} className="vm-icobtn vm-back" aria-label={tr("Branches")}>
      <IconChevronBack />
      <span className="vm-bdi" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fleet.selected?.name ?? tr("Branches")}</span>
    </Link>
  );

  const nameOf = (sc: Scene): string => {
    const own = sc.schedule.name?.trim();
    if (sc.quiet) return own || tr("Quiet");
    return lookup(sc.schedule)?.title || own || tr("Playlist");
  };

  return (
    <VmPage title={tr("Today's plan")} subtitle={dateLabel} lead={back}>
      <div className="vm-group" style={{ marginTop: 14 }}>
        <VmScheduleSwitchLine branchId={branchId} />
      </div>

      {status === "loading" ? (
        <div className="vm-list" style={{ marginTop: 18 }} aria-busy>
          <div className="vm-skel" style={{ height: 64 }} />
          <div className="vm-skel" style={{ height: 64 }} />
          <div className="vm-skel" style={{ height: 64 }} />
        </div>
      ) : status === "error" ? (
        <div className="vm-empty">
          <h2>{tr("Couldn't load the plan")}</h2>
          <button type="button" className="vm-pill" onClick={() => window.location.reload()}>{tr("Try again")}</button>
        </div>
      ) : scenes.length === 0 ? (
        <div className="vm-empty">
          <IconUpNext />
          <h2>{tr("Nothing is planned for today")}</h2>
        </div>
      ) : (
        <div className="vm-plan">
          {scenes.map((sc) => {
            const isNow = playingNow === sc;
            const isNext = next === sc;
            const past = sc.end <= nowMin && !isNow;
            const until = sc.end >= DAY_MINUTES - 1 ? "" : tr("Until {time}", { time: formatMinutes(sc.end) });
            const u = sc.quiet ? undefined : lookup(sc.schedule);
            return (
              <div key={`${sc.schedule.id}:${sc.start}`} className="vm-plan-row" data-now={isNow ? "" : undefined} data-quiet={sc.quiet ? "" : undefined} data-past={past ? "" : undefined}>
                <span className="vm-plan-time">{formatMinutes(sc.start)}</span>
                {sc.quiet ? null : <VmCover src={u ? sourceCover(u) : null} name={nameOf(sc)} size={40} radius={10} />}
                <span className="vm-plan-text">
                  <span className="vm-plan-name vm-bdi">{nameOf(sc)}</span>
                  {until || sc.quiet ? <span className="vm-plan-sub">{until || tr("No music")}</span> : null}
                </span>
                {isNext ? <span className="vm-plan-next">{tr("Next")}</span> : null}
              </div>
            );
          })}
        </div>
      )}

      <p className="vm-plan-note">{tr("The plan is edited on the computer.")}</p>
    </VmPage>
  );
}
