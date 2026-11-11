/**
 * What the schedule engine should do right now — PURE (no I/O, no React): the decision that `components/schedule-auto-player.tsx` acts on every poll.
 *
 * Owner 2026-11-11 ("a block can END at a time; a QUIET block / closing of the day; after the end nothing plays"):
 *   · START  — the block that should be playing now (the one that started LATEST among the active ones) starts once per day, like before.
 *   · STOP   — a QUIET block (`targetType: "SILENCE"`) stops the music when it starts; a block with an explicit END (`endTimeLocal`, anything but the default
 *              23:59) that the engine started today stops the music once its end has passed and no other block took over.
 *   · The block that took over last (the one that started LATEST today, ended or not) is the only one that can act; once it has acted today, NOTHING else acts. A
 *     later block replaces an earlier one for good, so music never "falls back" to an earlier block after a block ends. (Before, a block that had already fired was
 *     removed first, so an EARLIER block that never fired — the app was closed when it started — could win the next poll and start over the right one. With a
 *     quiet block this would have turned the music back on after closing time.)
 * An explicit end is exclusive ("ends 22:00" = silent from 22:00:00); the default end (23:59) keeps the old inclusive rule. A block that never fired today
 * (the app was closed, the block is opted out here) is never stopped. Playback itself (play / stop paths) is untouched: this only DECIDES.
 */
import type { Schedule } from "@/lib/types";
import { isScheduleInActiveWindow, numericSchedulePriority, parseLocalTimeToMinutes, scheduleAutoFireStorageKey } from "@/lib/schedule-window";

const DEFAULT_END_MINUTES = 23 * 60 + 59;
/** an end that passed longer ago than this (a restart long after closing time) no longer triggers a stop */
const END_GRACE_MINUTES = 90;

export type ScheduleAction =
  | { kind: "start"; schedule: Schedule; fireKey: string }
  | { kind: "stop"; schedule: Schedule; reason: "silence" | "end"; fireKeys: string[] }
  | null;

export function isSilenceBlock(s: Schedule): boolean {
  return s.targetType === "SILENCE";
}

/** the end a person set, in minutes after midnight; null = "until the next block" (nothing stored, the default 23:59, or an end that is not after the start) */
export function explicitEndMinutes(s: Schedule): number | null {
  const raw = (s.endTimeLocal ?? "").trim();
  if (!raw) return null;
  const end = parseLocalTimeToMinutes(raw);
  if (end >= DEFAULT_END_MINUTES) return null;
  if (end <= parseLocalTimeToMinutes(s.startTimeLocal)) return null;
  return end;
}

function dayMatches(s: Schedule, now: Date): boolean {
  // the legacy day logic (weekday list / one-time date) without any time-of-day, by asking about the whole day
  return isScheduleInActiveWindow({ ...s, startTimeLocal: "00:00", endTimeLocal: "23:59" }, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0));
}

/** has the block's day come and its start passed (a legacy overnight window still counts as "started")? Its own end is NOT looked at here. */
function hasStarted(s: Schedule, now: Date): boolean {
  if (!s.enabled) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  if (dayMatches(s, now) && cur >= parseLocalTimeToMinutes(s.startTimeLocal)) return true;
  return isScheduleInActiveWindow(s, now);
}

/** one stop per block per day for an END (the start key already says "it started today") */
export function scheduleEndFireStorageKey(schedule: Schedule, now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `syncbiz-schedule-end-${schedule.id}-${y}-${m}-${d}-${schedule.endTimeLocal}`;
}

function currentBlock(active: Schedule[]): Schedule | null {
  if (active.length === 0) return null;
  const sorted = [...active].sort((a, b) => {
    const sa = parseLocalTimeToMinutes(a.startTimeLocal);
    const sb = parseLocalTimeToMinutes(b.startTimeLocal);
    if (sa !== sb) return sb - sa; // latest start first
    const pa = numericSchedulePriority(a);
    const pb = numericSchedulePriority(b);
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
  return sorted[0] ?? null;
}

/** the block that took over last today (the one that started LATEST, ended or not), or null */
export function currentBlockAt(schedules: Schedule[], now: Date, skipIds?: Set<string>): Schedule | null {
  return currentBlock(schedules.filter((s) => !skipIds?.has(s.id) && hasStarted(s, now)));
}

/** the music that should be playing at `now` — null when it is quiet (a quiet block, an ended block, or nothing started yet) */
export function playingBlockAt(schedules: Schedule[], now: Date, skipIds?: Set<string>): Schedule | null {
  const current = currentBlockAt(schedules, now, skipIds);
  if (!current || isSilenceBlock(current)) return null;
  const end = explicitEndMinutes(current);
  return end !== null && now.getHours() * 60 + now.getMinutes() >= end ? null : current;
}

export function decideScheduleAction(input: {
  schedules: Schedule[];
  now: Date;
  /** blocks switched off on this computer (the per-block opt-out) */
  skipIds?: Set<string>;
  /** has this storage key already been used today (localStorage in the app)? */
  hasFired: (key: string) => boolean;
  /** the first look after the app (re)started: a quiet period is made quiet again even if its stop already ran today (music restored after a restart must not play on after closing time) */
  reassertSilence?: boolean;
}): ScheduleAction {
  const { now, hasFired } = input;
  const cur = now.getHours() * 60 + now.getMinutes();
  // the day is a sequence: the block that took over last is the only one that can act, and a later block replaces an earlier one for good
  const current = currentBlockAt(input.schedules, now, input.skipIds);
  if (!current) return null;
  const startKey = scheduleAutoFireStorageKey(current, now);

  if (isSilenceBlock(current)) {
    return hasFired(startKey) && !input.reassertSilence ? null : { kind: "stop", schedule: current, reason: "silence", fireKeys: [startKey] };
  }
  const end = explicitEndMinutes(current);
  if (end !== null && cur >= end) {
    // its end has passed and no other block took over: stop ONCE, but only a block this engine started today, and not long after the fact (a late restart)
    const endKey = scheduleEndFireStorageKey(current, now);
    if (cur - end > END_GRACE_MINUTES || !hasFired(startKey) || hasFired(endKey)) return null;
    return { kind: "stop", schedule: current, reason: "end", fireKeys: [endKey] };
  }
  return hasFired(startKey) ? null : { kind: "start", schedule: current, fireKey: startKey };
}
