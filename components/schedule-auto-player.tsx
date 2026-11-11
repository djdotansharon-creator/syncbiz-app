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
import { decideScheduleAction } from "@/lib/schedule-actions";
import type { Schedule, Source } from "@/lib/types";

/** Fixed cadence (owner 2026-10-15, 400-branch network): schedules are minute-granular → one check every 30 s. */
const POLL_MS = 30_000;

/**
 * While this browser tab is open, polls schedules and acts on `decideScheduleAction` (lib/schedule-actions.ts, pure + tested):
 *   · START  — the block that should be playing now (**latest start** wins; then priority, then id) starts once per day (localStorage key), like before;
 *   · STOP   — a quiet block (SILENCE) stops the music at its start; a block with an explicit END that this engine started today stops it once the end has passed
 *              (2026-11-11, owner). The stop is the Stop button's own path (`stopScheduled` = device.stopOrSend).
 * Only the block that took over LAST can act — an earlier block that never fired (the app was closed) no longer wins a later poll. Polls are aligned to :00 / :30 of
 * every minute so a stop lands within a second of its time. Respects Schedule engine on/off and per-block opt-out.
 */
export function ScheduleAutoPlayer() {
  const router = useRouter();
  const { engineEnabled } = useScheduleEngine();
  const { isRestoring } = usePlayback();
  const { stop, stopScheduled, setQueue, playSource, setLastMessage, route } = useSchedulePlaybackHandlers();
  const busyRef = useRef(false);
  // FLOOD FIX (2026-10-15): the playback handlers change identity on EVERY station status update (several per second).
  // They were effect deps, so the effect — and its immediate tick() → GET /api/schedules — re-ran on every update
  // (TEST logs: up to 8 requests/s per app). The latest handlers now live in a ref read at fire time; the polling
  // effect depends only on the engine switch + restore state → exactly one request per POLL_MS.
  const handlersRef = useRef({ router, stop, stopScheduled: undefined as undefined | (() => void), setQueue, playSource, setLastMessage, route });
  useEffect(() => {
    handlersRef.current = { router, stop, stopScheduled, setQueue, playSource, setLastMessage, route };
  });

  useEffect(() => {
    let cancelled = false;
    let firstLook = true; // after (re)start, once: a quiet period is made quiet again (see decideScheduleAction.reassertSilence)

    async function tick() {
      if (!engineEnabled || cancelled || busyRef.current) return;
      if (isRestoring) return;
      // 2026-11-04: designated station window whose route is not known yet (MAIN designation pending) → retry next poll.
      if (handlersRef.current.route?.kind === "wait") return;

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
        const hasFired = (k: string) => {
          try {
            return typeof localStorage !== "undefined" && localStorage.getItem(k) === "1";
          } catch {
            return false;
          }
        };
        const action = decideScheduleAction({ schedules, now, skipIds, hasFired, reassertSilence: firstLook });
        firstLook = false;
        if (!action) return;
        if (action.kind === "stop") {
          const h = handlersRef.current;
          try {
            (h.stopScheduled ?? h.stop)();
          } catch {
            return; // retried next poll
          }
          for (const k of action.fireKeys) {
            try {
              localStorage.setItem(k, "1");
            } catch {
              /* ignore quota */
            }
          }
          return;
        }
        const winner = action.schedule;

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
          const h = handlersRef.current;
          ok = await runSchedulePlayback(
            winner,
            source,
            { stop: h.stop, setQueue: h.setQueue, playSource: h.playSource, setLastMessage: h.setLastMessage, route: h.route },
            h.router,
          );
        } catch {
          return;
        }
        if (!ok) return;

        const fireKey = action.fireKey;
        try {
          localStorage.setItem(fireKey, "1");
        } catch {
          /* ignore quota */
        }
      } finally {
        busyRef.current = false;
      }
    }

    // polls aligned to :00 / :30 of every minute (+0.3 s): a block's start or end is acted on within about a second of its time
    let timer: number | undefined;
    const arm = () => {
      timer = window.setTimeout(async () => {
        await tick();
        if (!cancelled) arm();
      }, POLL_MS - (Date.now() % POLL_MS) + 300);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    const onPrefs = () => void tick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(SCHEDULE_AUTO_PREFS_EVENT, onPrefs);
    window.addEventListener("storage", onPrefs);
    void tick();
    arm();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(SCHEDULE_AUTO_PREFS_EVENT, onPrefs);
      window.removeEventListener("storage", onPrefs);
    };
  }, [engineEnabled, isRestoring]);

  return null;
}
