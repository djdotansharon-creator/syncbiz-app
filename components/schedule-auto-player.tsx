"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { runSchedulePlayback } from "@/lib/schedule-playback-client";
import { useSchedulePlaybackHandlers } from "@/lib/use-schedule-playback-handlers";
import { usePlayback } from "@/lib/playback-provider";
import {
  getScheduleAutoOptOutIds,
  SCHEDULE_AUTO_PREFS_EVENT,
} from "@/lib/schedule-auto-preferences";
import { decideScheduleAction, todaysFiredKeys } from "@/lib/schedule-actions";
import { SCHEDULE_SWITCH_EVENT } from "@/lib/schedule-switch-client";
import { clearScheduleDriven } from "@/lib/schedule-driven";
import { clearQuietStopTries, noteQuietStopTry, quietStopFinished, waitForQuiet } from "@/lib/schedule-quiet-stop";
import { stationBranchIdNow, useStationBranchId } from "@/lib/station-branch";
import type { Schedule, Source } from "@/lib/types";

/** Fixed cadence (owner 2026-10-15, 400-branch network): schedules are minute-granular → one check every 30 s. */
const POLL_MS = 30_000;
/** the last schedules this computer received for its branch, kept for the moments the network is down (not older than 36 hours) — with the branch's schedule switch as it was then */
const SCHEDULES_CACHE_KEY = "syncbiz-schedules-cache-v1";
function readCachedSchedules(branch: string): { schedules: Schedule[]; enabled: boolean } | null {
  try {
    const raw = localStorage.getItem(`${SCHEDULES_CACHE_KEY}:${branch}`);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: number; schedules?: Schedule[]; enabled?: boolean };
    if (!v || typeof v.at !== "number" || !Array.isArray(v.schedules) || Date.now() - v.at > 36 * 3600_000) return null;
    return { schedules: v.schedules, enabled: v.enabled !== false };
  } catch {
    return null;
  }
}

/**
 * While this browser tab is open, polls schedules and acts on `decideScheduleAction` (lib/schedule-actions.ts, pure + tested):
 *   · START  — the block that should be playing now (**latest start** wins; then priority, then id) starts once per day (localStorage key), like before;
 *   · STOP   — a quiet block (SILENCE) stops the music at its start; a block with an explicit END that this engine started today stops it once the end has passed
 *              (2026-11-11, owner). The stop is the Stop button's own path (`stopScheduled` = device.stopOrSend).
 * Branch scope (2026-11-15): only this window's own branch's schedules are fetched (`?branchId=`) — see lib/schedule-branch-scope.ts.
 * The branch's SCHEDULE SWITCH (2026-11-16) comes with them (`X-Schedule-Enabled`, kept with the cached copy for when the network is down): while it is off nothing starts and nothing stops;
 * the moment it comes back on, today's "already started" marks are cleared so the block that should be playing now starts at once.
 * Only the block that took over LAST can act — an earlier block that never fired (the app was closed) no longer wins a later poll. Polls are aligned to :00 / :30 of
 * every minute so a stop lands within a second of its time. Respects Schedule engine on/off and per-block opt-out.
 */
export function ScheduleAutoPlayer() {
  const router = useRouter();
  const { isRestoring } = usePlayback();
  const { stop, stopScheduled, isAudible, setQueue, playSource, setLastMessage, route, bankStreamReady } = useSchedulePlaybackHandlers();
  // 2026-11-15 (owner: "the schedule I set for one player affects all the others"): a window runs ONLY the schedules of the branch it plays for / controls. On the desktop the branch is
  // MAIN's (null until the bridge answers — then nothing starts and the next poll retries); a browser / phone has "default" unless a branch was chosen in Control Room.
  const stationBranch = useStationBranchId();
  const busyRef = useRef(false);
  const wasEnabled = useRef<boolean | null>(null); // the branch switch as the last look saw it: off -> on clears today's marks
  // FLOOD FIX (2026-10-15): the playback handlers change identity on EVERY station status update (several per second).
  // They were effect deps, so the effect — and its immediate tick() → GET /api/schedules — re-ran on every update
  // (TEST logs: up to 8 requests/s per app). The latest handlers now live in a ref read at fire time; the polling
  // effect depends only on the engine switch + restore state → exactly one request per POLL_MS.
  const handlersRef = useRef({ router, stop, stopScheduled: undefined as undefined | (() => void), isAudible: undefined as undefined | (() => boolean), setQueue, playSource, setLastMessage, route, bankStreamReady });
  useEffect(() => {
    handlersRef.current = { router, stop, stopScheduled, isAudible, setQueue, playSource, setLastMessage, route, bankStreamReady };
  });

  useEffect(() => {
    let cancelled = false;
    let firstLook = true; // after (re)start, once: a quiet period is made quiet again (see decideScheduleAction.reassertSilence)

    async function tick() {
      if (cancelled || busyRef.current) return;
      if (isRestoring) return;
      // 2026-11-04: designated station window whose route is not known yet (MAIN designation pending) → retry next poll.
      if (handlersRef.current.route?.kind === "wait") return;
      const branch = stationBranchIdNow();
      if (branch === null) return; // this window's branch is not known yet: start nothing (never another branch's music)

      busyRef.current = true;
      try {
        // Network calls can throw (offline, tab nav, slow 5G on mobile, dev
        // reload). We intentionally swallow transient failures — the next
        // poll tick will retry. Surfacing them would produce noisy red
        // "Failed to fetch" overlays on mobile for a recoverable condition.
        let schedules: Schedule[] | null = null;
        let enabled = true; // the branch's schedule switch: a request that carries no flag (an older server) means on
        try {
          const res = await fetch(`/api/schedules?branchId=${encodeURIComponent(branch)}`, {
            credentials: "include",
            cache: "no-store",
          });
          if (!res.ok || cancelled) return;
          enabled = res.headers.get("x-schedule-enabled") !== "0";
          schedules = (await res.json()) as Schedule[];
          try {
            localStorage.setItem(`${SCHEDULES_CACHE_KEY}:${branch}`, JSON.stringify({ at: Date.now(), schedules, enabled }));
          } catch {
            /* no room: the copy is only a help */
          }
        } catch {
          // the network is down (CLAUDE.md §14: nothing may need it): the last copy of this branch's schedules — and the switch as it was — still decides; a closing time must silence the music even offline
          const cached = readCachedSchedules(branch);
          if (!cached) return;
          schedules = cached.schedules;
          enabled = cached.enabled;
        }
        // switched back ON: the block that should be playing now starts at once, even one that had already started earlier today
        if (enabled && wasEnabled.current === false) {
          try {
            for (const k of todaysFiredKeys(Object.keys(localStorage), new Date())) localStorage.removeItem(k);
          } catch {
            /* storage not available: it starts at the next block */
          }
        }
        wasEnabled.current = enabled;
        if (!enabled) return; // the branch's schedule is off: nothing starts, nothing stops
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
          clearScheduleDriven(); // a quiet block: the schedule's music is over, nothing is lined up after it
          // The stop is a COMMAND (on a station playing a URL session it goes to MAIN through the cloud socket, and a command that leaves while the socket is closed is lost without a word).
          // It counts as done — and the block is marked for today — only when the music has really gone quiet; otherwise the next poll repeats it (lib/schedule-quiet-stop.ts).
          const tryNo = noteQuietStopTry(action.fireKeys[0] ?? action.schedule.id);
          const quiet = await waitForQuiet(() => handlersRef.current.isAudible?.() === true, { cancelled: () => cancelled });
          if (cancelled) return;
          const finished = quietStopFinished(quiet, tryNo);
          console.info(`[VONO schedule] quiet block "${action.schedule.name ?? action.schedule.id}" — stop sent (try ${tryNo}); ${quiet ? "the music is quiet" : finished ? "still playing — giving up so it never fights a person" : "still playing — will repeat at the next poll"}`);
          if (!finished) return;
          for (const k of action.fireKeys) {
            clearQuietStopTries(k);
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
            { stop: h.stop, setQueue: h.setQueue, playSource: h.playSource, setLastMessage: h.setLastMessage, route: h.route, bankStreamReady: h.bankStreamReady },
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
    window.addEventListener(SCHEDULE_SWITCH_EVENT, onPrefs); // this window flipped the branch's switch: look at once
    window.addEventListener(SCHEDULE_AUTO_PREFS_EVENT, onPrefs);
    window.addEventListener("storage", onPrefs);
    void tick();
    arm();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(SCHEDULE_SWITCH_EVENT, onPrefs);
      window.removeEventListener(SCHEDULE_AUTO_PREFS_EVENT, onPrefs);
      window.removeEventListener("storage", onPrefs);
    };
  }, [isRestoring, stationBranch]);

  return null;
}
