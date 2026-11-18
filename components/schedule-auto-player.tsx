"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { runSchedulePlayback } from "@/lib/schedule-playback-client";
import { useSchedulePlaybackHandlers } from "@/lib/use-schedule-playback-handlers";
import { usePlayback } from "@/lib/playback-provider";
import {
  getScheduleAutoOptOutIds,
  SCHEDULE_AUTO_PREFS_EVENT,
} from "@/lib/schedule-auto-preferences";
import { currentBlockAt, decideScheduleAction, playingBlockAt, todaysFiredKeys } from "@/lib/schedule-actions";
import { scheduleAutoFireStorageKey } from "@/lib/schedule-window";
import { ymdOf } from "@/lib/schedule-skip";
import { decideStartCheck, type StartWatch } from "@/lib/schedule-start-retry";
import { FADE_STEP_MS, fadeOutLevels, readFadeRestore, shouldFadeStop, writeFadeRestore } from "@/lib/schedule-fade";
import { applyBlockVolume, setScheduleVolumeLock } from "@/lib/schedule-volume";
import { SCHEDULE_SWITCH_EVENT } from "@/lib/schedule-switch-client";
import { clearScheduleDriven } from "@/lib/schedule-driven";
import { clearQuietStopTries, noteQuietStopTry, peekQuietStopTries, quietStopFinished, waitForQuiet } from "@/lib/schedule-quiet-stop";
import { stationBranchIdNow, useStationBranchId } from "@/lib/station-branch";
import { scheduleScopeNote } from "@/lib/schedule-branch-scope";
import type { PlayStatus } from "@/lib/schedule-start-retry";
import type { Schedule, Source } from "@/lib/types";

/** Fixed cadence (owner 2026-10-15, 400-branch network): schedules are minute-granular → one check every 30 s. */
const POLL_MS = 30_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/**
 * Why the schedule's log lines are `console.warn`: the desktop app's main process mirrors ONLY renderer warnings / errors into main.log (its `console-message` handler, level ≥ 2). The engine's lines used to be
 * `console.info`, so on a station none of them (a start, a quiet stop, a retry…) ever reached main.log and a "why did it not play" question had no evidence. They are event-driven (a block's start / stop,
 * a change of scope), a handful a day.
 */
/** how many polls a controller window waits for the player's state to become known before it treats the player as silent */
const WATCH_UNKNOWN_MAX = 4;
/** a browser window that has just opened does nothing for this long (unless it is the station's own window): the cloud socket needs a moment to tell it whether another player exists, and the first look used to start the block at once */
const WINDOW_SETTLE_MS = 12_000;
/** the phone app (/mobile) is a REMOTE, never a player: it runs no schedule of its own */
const PHONE_APP = /^\/mobile(\/|$)/;
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
  const pathname = usePathname();
  // 2026-11-18 (PROVEN BY RUNTIME): a phone window opened in the middle of a block — its own "started today" memory empty — handed the block's start to the player, over what was playing. The phone is a
  // remote (owner: "for us the phone is only a remote, not a player"): the station's own window runs the schedule, so the phone app runs none.
  const isPhoneApp = PHONE_APP.test(pathname ?? "");
  const { isRestoring } = usePlayback();
  const { stop, stopScheduled, isAudible, getPlayStatus, controlsAnotherPlayer, getVolume, setVolume, setQueue, playSource, setLastMessage, route, bankStreamReady } = useSchedulePlaybackHandlers();
  // 2026-11-15 (owner: "the schedule I set for one player affects all the others"): a window runs ONLY the schedules of the branch it plays for / controls. On the desktop the branch is
  // MAIN's (null until the bridge answers — then nothing starts and the next poll retries); a browser / phone has "default" unless a branch was chosen in Control Room.
  const stationBranch = useStationBranchId();
  const busyRef = useRef(false);
  const wasEnabled = useRef<boolean | null>(null); // the branch switch as the last look saw it: off -> on clears today's marks
  // 2026-11-18: the start that was handed over and is being watched until the music is really playing (lib/schedule-start-retry.ts), and how many starts a repeated block has had
  const watchState = useRef<{ at: number; day: string; min: number; unknown: number } | null>(null); // when this window began to watch, and how often the player's state was unknown
  if (watchState.current === null && typeof window !== "undefined") {
    const d = new Date();
    watchState.current = { at: d.getTime(), day: ymdOf(d), min: d.getHours() * 60 + d.getMinutes(), unknown: 0 };
  }
  const lastScopeNote = useRef<string | null>(null); // the last "which branch's schedule" line written to the log
  const startWatch = useRef<StartWatch | null>(null);
  const retryCarry = useRef<{ key: string; tries: number } | null>(null);
  // FLOOD FIX (2026-10-15): the playback handlers change identity on EVERY station status update (several per second).
  // They were effect deps, so the effect — and its immediate tick() → GET /api/schedules — re-ran on every update
  // (TEST logs: up to 8 requests/s per app). The latest handlers now live in a ref read at fire time; the polling
  // effect depends only on the engine switch + restore state → exactly one request per POLL_MS.
  const handlersRef = useRef({ router, stop, stopScheduled: undefined as undefined | (() => void), isAudible: undefined as undefined | (() => boolean), getPlayStatus: undefined as undefined | (() => PlayStatus), controlsAnotherPlayer: undefined as undefined | (() => boolean), getVolume: undefined as undefined | (() => number | null), setVolume: undefined as undefined | ((v: number) => void), setQueue, playSource, setLastMessage, route, bankStreamReady });
  useEffect(() => {
    handlersRef.current = { router, stop, stopScheduled, isAudible, getPlayStatus, controlsAnotherPlayer, getVolume, setVolume, setQueue, playSource, setLastMessage, route, bankStreamReady };
  });

  useEffect(() => {
    let cancelled = false;
    let firstLook = true; // after (re)start, once: a quiet period is made quiet again (see decideScheduleAction.reassertSilence)
    let fadeRestoreChecked = false; // after (re)start, once: the volume of a fade that never finished is given back
    if (isPhoneApp) return; // the phone is a remote: no schedule of its own

    async function tick() {
      if (cancelled || busyRef.current) return;
      if (isRestoring) return;
      // 2026-11-04: designated station window whose route is not known yet (MAIN designation pending) → retry next poll.
      if (handlersRef.current.route?.kind === "wait") return;
      // a browser window that has only just opened waits a moment (the station's own window does not): see WINDOW_SETTLE_MS
      if (handlersRef.current.route?.kind !== "station" && Date.now() - (watchState.current?.at ?? 0) < WINDOW_SETTLE_MS) return;
      const branch = stationBranchIdNow();
      if (branch === null) return; // this window's branch is not known yet: start nothing (never another branch's music)

      busyRef.current = true;
      try {
        if (!fadeRestoreChecked) {
          fadeRestoreChecked = true;
          const left = readFadeRestore();
          if (left !== null) {
            // a window was closed in the middle of a fade-out: the player must not stay quiet
            try {
              handlersRef.current.setVolume?.(left);
            } catch {
              /* a failed change is not retried */
            }
            writeFadeRestore(null);
            console.warn(`[VONO schedule] a fade-out that never finished — volume ${left}% put back`);
          }
        }
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
          // which branch's schedule this station follows, written to the log when it changes (audit F2: a block of another branch silently never starts here)
          const otherHeader = res.headers.get("x-schedules-other-branches");
          const other = otherHeader === null || otherHeader.trim() === "" || !Number.isFinite(Number(otherHeader)) ? null : Number(otherHeader);
          const note = scheduleScopeNote({ branch, blocks: Array.isArray(schedules) ? schedules.length : 0, enabled, otherBranches: other });
          if (note && note !== lastScopeNote.current) {
            lastScopeNote.current = note;
            console.warn(`[VONO schedule] ${note}`);
          }
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
        if (!enabled) {
          setScheduleVolumeLock(null); // the schedule is off: no block's volume is in force
          return; // the branch's schedule is off: nothing starts, nothing stops
        }
        if (!Array.isArray(schedules) || schedules.length === 0) {
          setScheduleVolumeLock(null);
          return;
        }

        const now = new Date();
        const skipIds = getScheduleAutoOptOutIds();
        const hasFired = (k: string) => {
          try {
            return typeof localStorage !== "undefined" && localStorage.getItem(k) === "1";
          } catch {
            return false;
          }
        };
        // a block's own VOLUME (owner 2026-11-17): the block in force tells the volume guard what the setting is (a raise above it is asked about), and after a restart inside the block the setting is put back
        const inForce = playingBlockAt(schedules, now, skipIds);
        const blockVolume = inForce && typeof inForce.volume === "number" ? inForce.volume : null;
        setScheduleVolumeLock(inForce && blockVolume !== null ? { blockId: inForce.id, name: inForce.name ?? "", volume: blockVolume } : null);
        // a start that was handed over must really have started the music (lib/schedule-start-retry.ts): into SILENCE only, a poll later, at most three starts in all
        const sw = startWatch.current;
        if (sw) {
          const cur = currentBlockAt(schedules, now, skipIds);
          const verdict = decideStartCheck({ watch: sw, now: Date.now(), status: handlersRef.current.getPlayStatus?.() ?? null, stillCurrent: !!cur && scheduleAutoFireStorageKey(cur, now) === sw.key });
          if (verdict === "retry") {
            console.warn(`[VONO schedule] the start of the block did not start the music (try ${sw.tries}) — starting it again`);
            retryCarry.current = { key: sw.key, tries: sw.tries };
            startWatch.current = null;
            try {
              localStorage.removeItem(sw.key);
            } catch {
              /* it is tried again at the next poll */
            }
          } else if (verdict === "give-up") {
            console.warn(`[VONO schedule] the block's music did not start after ${sw.tries} tries — leaving it`);
            startWatch.current = null;
            retryCarry.current = null;
          } else if (verdict === "ok") {
            startWatch.current = null;
            retryCarry.current = null;
          }
        }
        // a window that only CONTROLS another player and opens in the middle of a block must not play over music that is already playing (decideScheduleAction.watch)
        let watch: { sinceMin: number; audible: boolean | null } | undefined;
        const ws = watchState.current;
        if (ws && handlersRef.current.controlsAnotherPlayer?.()) {
          const ymd = ymdOf(now);
          if (ymd !== ws.day) {
            ws.day = ymd;
            ws.min = 0; // a window open across midnight has watched every minute of the new day
          }
          const st = handlersRef.current.getPlayStatus?.() ?? null;
          ws.unknown = st === null ? ws.unknown + 1 : 0;
          watch = { sinceMin: ws.min, audible: st === null ? (ws.unknown > WATCH_UNKNOWN_MAX ? false : null) : st === "playing" };
        }
        const wasFirstLook = firstLook;
        const action = decideScheduleAction({ schedules, now, skipIds, hasFired, reassertSilence: firstLook, watch });
        if (firstLook && blockVolume !== null && handlersRef.current.getVolume?.() !== blockVolume) {
          const set = applyBlockVolume(handlersRef.current, blockVolume);
          if (set !== null) console.warn(`[VONO schedule] restart inside "${inForce?.name ?? inForce?.id}" — its volume ${set}% put back`);
        }
        firstLook = false;
        if (!action) return;
        if (action.kind === "adopt") {
          // the block is in force and music that this window did not start is playing (a person's choice, or the player's own window started the block): it is marked as handled, nothing is played over it
          try {
            localStorage.setItem(action.fireKey, "1");
          } catch {
            /* ignore quota */
          }
          console.warn(`[VONO schedule] "${action.schedule.name ?? action.schedule.id}" was already in force when this window opened and music is playing — left alone`);
          return;
        }
        if (action.kind === "stop") {
          const h = handlersRef.current;
          const stopKey = action.fireKeys[0] ?? action.schedule.id;
          // owner/father 2026-11-18: a scheduled stop ends with a 9-second FADE-OUT (lib/schedule-fade.ts) — through the Player's own volume path, so MAIN / the installer are untouched. Only the first try of a stop fades.
          const volumeBefore = h.getVolume?.() ?? null;
          let restoreVolume: number | null = null;
          const giveBackVolume = () => {
            if (restoreVolume === null) return;
            try {
              h.setVolume?.(restoreVolume);
            } catch {
              /* a failed change is not retried */
            }
            writeFadeRestore(null);
            restoreVolume = null;
          };
          const fadeInput = { firstLook: wasFirstLook, tryNo: peekQuietStopTries(stopKey) + 1, audible: h.isAudible?.() === true, volume: volumeBefore, canSetVolume: !!h.setVolume };
          const fading = shouldFadeStop(fadeInput);
          const fadeNote = fading ? `fade-out from ${volumeBefore}%` : `no fade (first look ${fadeInput.firstLook}, try ${fadeInput.tryNo}, playing ${fadeInput.audible}, volume ${volumeBefore ?? "unknown"})`;
          if (fading) {
            restoreVolume = volumeBefore;
            writeFadeRestore(restoreVolume);
            try {
              for (const level of fadeOutLevels(restoreVolume!)) {
                if (cancelled) break;
                h.setVolume!(level);
                await sleep(FADE_STEP_MS);
              }
            } catch {
              /* a fade that cannot go on simply stops here; the stop below still happens */
            }
          }
          try {
            (h.stopScheduled ?? h.stop)();
          } catch {
            giveBackVolume();
            return; // retried next poll
          }
          clearScheduleDriven(); // a quiet block: the schedule's music is over, nothing is lined up after it
          // The stop is a COMMAND (on a station playing a URL session it goes to MAIN through the cloud socket, and a command that leaves while the socket is closed is lost without a word).
          // It counts as done — and the block is marked for today — only when the music has really gone quiet; otherwise the next poll repeats it (lib/schedule-quiet-stop.ts).
          const tryNo = noteQuietStopTry(stopKey);
          const quiet = await waitForQuiet(() => handlersRef.current.isAudible?.() === true, { cancelled: () => cancelled });
          giveBackVolume(); // the volume is put back only now that the music is quiet (or the stop did not work), so the next block starts at the right level
          if (cancelled) return;
          const finished = quietStopFinished(quiet, tryNo);
          console.warn(`[VONO schedule] quiet block "${action.schedule.name ?? action.schedule.id}" — ${fadeNote}; stop sent (try ${tryNo}); ${quiet ? "the music is quiet" : finished ? "still playing — giving up so it never fights a person" : "still playing — will repeat at the next poll"}`);
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
        // the block's own volume (or the volume the player had before a schedule changed it) is set BEFORE the music starts, so a quieter block never begins at the old, louder level
        {
          const set = applyBlockVolume(handlersRef.current, typeof winner.volume === "number" ? winner.volume : null);
          if (set !== null) console.warn(`[VONO schedule] "${winner.name ?? winner.id}" starts — volume ${set}%`);
        }

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
        // the start is watched until the music is really playing; a start that went nowhere is repeated into silence (lib/schedule-start-retry.ts)
        const carry = retryCarry.current;
        startWatch.current = { key: fireKey, at: Date.now(), tries: carry && carry.key === fireKey ? carry.tries + 1 : 1 };
        console.warn(`[VONO schedule] "${winner.name ?? winner.id}" — start handed over to the player (try ${startWatch.current.tries})`);
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
  }, [isRestoring, stationBranch, isPhoneApp]);

  return null;
}
