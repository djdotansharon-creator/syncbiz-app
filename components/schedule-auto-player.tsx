"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { runSchedulePlayback } from "@/lib/schedule-playback-client";
import { useSchedulePlaybackHandlers } from "@/lib/use-schedule-playback-handlers";
import { usePlayback } from "@/lib/playback-provider";
import { useScheduleEngine } from "@/lib/schedule-engine-context";
import {
  getScheduleAutoOptOutIds,
  SCHEDULE_AUTO_PREFS_EVENT,
} from "@/lib/schedule-auto-preferences";
import {
  pickWinningScheduleForNow,
  scheduleAutoFireStorageKey,
} from "@/lib/schedule-window";
import type { Schedule, Source } from "@/lib/types";

const POLL_MS = 8_000;

/**
 * While this browser tab is open, polls schedules and starts playback when a block’s window is active.
 * Schedules that **already auto-fired today** (localStorage) are excluded — a 10:00 run does not compete at 10:02.
 * Among remaining active blocks, **latest start time** wins if windows overlap; then priority, then id.
 * Respects Schedule engine on/off and per-block opt-out.
 */
export function ScheduleAutoPlayer() {
  const router = useRouter();
  const { engineEnabled } = useScheduleEngine();
  const { isRestoring } = usePlayback();
  const { stop, setQueue, playSource, setLastMessage } = useSchedulePlaybackHandlers();
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (!engineEnabled || cancelled || busyRef.current) return;
      if (isRestoring) return;

      busyRef.current = true;
      try {
        // Network calls can throw (offline, tab nav, slow 5G on mobile, dev
        // reload). We intentionally swallow transient failures — the next
        // poll tick will retry. Surfacing them would produce noisy red
        // "Failed to fetch" overlays on mobile for a recoverable condition.
        let schedules: Schedule[] | null = null;
        try {
          const res = await fetch("/api/schedules", {
            credentials: "include",
            cache: "no-store",
          });
          if (!res.ok || cancelled) return;
          schedules = (await res.json()) as Schedule[];
        } catch {
          return;
        }
        if (!Array.isArray(schedules) || schedules.length === 0) return;

        const now = new Date();
        const skipIds = getScheduleAutoOptOutIds();
        const pending = schedules.filter((s) => {
          if (skipIds.has(s.id)) return false;
          const key = scheduleAutoFireStorageKey(s, now);
          if (typeof localStorage !== "undefined" && localStorage.getItem(key) === "1") return false;
          return true;
        });
        const winner = pickWinningScheduleForNow(pending, now);
        if (!winner) return;

        let list: Source[] = [];
        try {
          const sourcesRes = await fetch("/api/sources", {
            credentials: "include",
            cache: "no-store",
          });
          if (cancelled) return;
          if (sourcesRes.ok) {
            const parsed = (await sourcesRes.json()) as Source[];
            list = Array.isArray(parsed) ? parsed : [];
          }
        } catch {
          return;
        }
        const sourceId =
          winner.targetType === "SOURCE" ? winner.targetId : winner.sourceId;
        const source =
          list.find((s) => s.id === (sourceId ?? "").trim()) ?? null;

        let ok = false;
        try {
          ok = await runSchedulePlayback(
            winner,
            source,
            { stop, setQueue, playSource, setLastMessage },
            router,
          );
        } catch {
          return;
        }
        if (!ok) return;

        const fireKey = scheduleAutoFireStorageKey(winner, now);
        try {
          localStorage.setItem(fireKey, "1");
        } catch {
          /* ignore quota */
        }
      } finally {
        busyRef.current = false;
      }
    }

    const id = window.setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    const onPrefs = () => void tick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(SCHEDULE_AUTO_PREFS_EVENT, onPrefs);
    window.addEventListener("storage", onPrefs);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(SCHEDULE_AUTO_PREFS_EVENT, onPrefs);
      window.removeEventListener("storage", onPrefs);
    };
  }, [engineEnabled, isRestoring, router, stop, setQueue, playSource, setLastMessage]);

  return null;
}
