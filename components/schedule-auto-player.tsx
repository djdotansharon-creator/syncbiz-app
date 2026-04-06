"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { usePlayback } from "@/lib/playback-provider";
import { runSchedulePlayback } from "@/lib/schedule-playback-client";
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
 * Fires at most once per schedule per local day (per start time). Respects Schedule engine on/off.
 */
export function ScheduleAutoPlayer() {
  const router = useRouter();
  const { engineEnabled } = useScheduleEngine();
  const { stop, setQueue, playSource, playSourceFromDb, setLastMessage } = usePlayback();
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (!engineEnabled || cancelled || busyRef.current) return;

      busyRef.current = true;
      try {
        const res = await fetch("/api/schedules", { credentials: "include", cache: "no-store" });
        if (!res.ok || cancelled) return;
        const schedules = (await res.json()) as Schedule[];
        if (!Array.isArray(schedules) || schedules.length === 0) return;

        const now = new Date();
        const skipIds = getScheduleAutoOptOutIds();
        const winner = pickWinningScheduleForNow(schedules, now, { skipScheduleIds: skipIds });
        if (!winner) return;

        const key = scheduleAutoFireStorageKey(winner, now);
        if (typeof localStorage !== "undefined" && localStorage.getItem(key) === "1") {
          return;
        }

        const sourcesRes = await fetch("/api/sources", { credentials: "include", cache: "no-store" });
        const sources = sourcesRes.ok ? ((await sourcesRes.json()) as Source[]) : [];
        const list = Array.isArray(sources) ? sources : [];
        const sourceId =
          winner.targetType === "SOURCE" ? winner.targetId : winner.sourceId;
        const source =
          list.find((s) => s.id === (sourceId ?? "").trim()) ?? null;

        const ok = await runSchedulePlayback(
          winner,
          source,
          { stop, setQueue, playSource, playSourceFromDb, setLastMessage },
          router,
        );
        if (!ok) return;

        try {
          localStorage.setItem(key, "1");
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
  }, [engineEnabled, router, stop, setQueue, playSource, playSourceFromDb, setLastMessage]);

  return null;
}
