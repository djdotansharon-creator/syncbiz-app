/**
 * Schedules Studio — the pure part (no React, no DOM): turns the stored schedule blocks into "what plays when" for each day of the week.
 *
 * The engine (`lib/schedule-window.ts`, `components/schedule-auto-player.tsx`) works with START triggers: a block is active from its start time until the end of the
 * day (the API stores end = 23:59 unless told otherwise), and when several blocks are active the one that STARTED LATEST wins. So, for one day, the music simply
 * changes at each start time and plays until the next one — which is exactly what `buildDayScenes` draws: every scene ends where the next one begins.
 * Display only: nothing here changes how or when playback is fired.
 */
import type { Schedule } from "@/lib/types";
import { parseLocalTimeToMinutes, numericSchedulePriority } from "@/lib/schedule-window";
import { explicitEndMinutes, isSilenceBlock } from "@/lib/schedule-actions";

export const DAY_MINUTES = 1440;
/** the week starts on Sunday (0), like `Schedule.daysOfWeek` */
export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export type Scene = {
  schedule: Schedule;
  day: number;
  /** minutes from local midnight */
  start: number;
  /** minutes from local midnight; the block's own END when one was set (and comes first), else the next scene's start, or the end of the day */
  end: number;
  /** a person set this block's end (a "ends at 17:50"), as opposed to "until the next block" */
  endSet: boolean;
  /** a QUIET block (no music from its start) — drawn hatched, named "Quiet" / "Closing" */
  quiet: boolean;
  /** a disabled block: drawn as a small dashed marker, it does not take part in the sequence */
  paused: boolean;
  /** a second block with exactly the same start time as another: it never plays (the first one wins) */
  shadowed: boolean;
};

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 485 → "08:05" */
export function formatMinutes(min: number): string {
  const m = Math.min(DAY_MINUTES - 1, Math.max(0, Math.round(min)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 485 → "08:05:00" (what the API stores) */
export function minutesToTimeLocal(min: number): string {
  return `${formatMinutes(min)}:00`;
}

/** what a person types into the time box: "7", "07", "730", "0730", "7:30", "19.30" → minutes, or null when it is not a time */
export function parseTypedTime(raw: string): number | null {
  const t = raw.trim().replace(/\./g, ":");
  let h: number;
  let m: number;
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (colon) {
    h = parseInt(colon[1]!, 10);
    m = parseInt(colon[2]!, 10);
  } else if (/^\d{1,2}$/.test(t)) {
    h = parseInt(t, 10);
    m = 0;
  } else if (/^\d{3,4}$/.test(t)) {
    h = parseInt(t.slice(0, t.length - 2), 10);
    m = parseInt(t.slice(-2), 10);
  } else {
    return null;
  }
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return null;
  return h * 60 + m;
}

export function snapMinutes(min: number, step = 15): number {
  const s = Math.round(min / step) * step;
  return Math.min(DAY_MINUTES - step, Math.max(0, s));
}

export function startMinutes(s: Schedule): number {
  return parseLocalTimeToMinutes(s.startTimeLocal);
}

/** the dates (YYYY-MM-DD) of Sunday … Saturday of the week that contains `now` — one-time blocks are placed by date */
export function weekDatesFor(now: Date): string[] {
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  return WEEK_DAYS.map((i) => {
    const d = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  });
}

/** does this block happen on `day` (0 = Sunday) of the week whose dates are `weekDates`? */
export function appliesOnDay(s: Schedule, day: number, weekDates: string[]): boolean {
  if (s.recurrence === "one_off") {
    const od = (s.oneOffDateLocal ?? "").trim();
    return !!od && weekDates[day] === od;
  }
  return Array.isArray(s.daysOfWeek) && s.daysOfWeek.includes(day);
}

/** the scenes of one day, in time order */
export function buildDayScenes(schedules: Schedule[], day: number, weekDates: string[]): Scene[] {
  const mine = schedules.filter((s) => appliesOnDay(s, day, weekDates));
  const active = mine
    .filter((s) => s.enabled)
    .sort((a, b) => {
      const d = startMinutes(a) - startMinutes(b);
      if (d !== 0) return d;
      const p = numericSchedulePriority(a) - numericSchedulePriority(b);
      return p !== 0 ? p : a.id.localeCompare(b.id);
    });
  const scenes: Scene[] = [];
  // the distinct start times, in order → every scene ends at the next distinct start
  const distinct = Array.from(new Set(active.map(startMinutes))).sort((a, b) => a - b);
  const seen = new Set<number>();
  for (const s of active) {
    const start = startMinutes(s);
    const i = distinct.indexOf(start);
    const nextStart = i + 1 < distinct.length ? distinct[i + 1]! : DAY_MINUTES;
    // the engine's own rule (lib/schedule-actions.ts): an explicit end stops the music at that time unless the next block comes first
    const quiet = isSilenceBlock(s);
    const own = quiet ? null : explicitEndMinutes(s);
    const end = own !== null && own < nextStart ? own : nextStart;
    const shadowed = seen.has(start);
    seen.add(start);
    scenes.push({ schedule: s, day, start, end, endSet: own !== null && own <= nextStart, quiet, paused: false, shadowed });
  }
  for (const s of mine.filter((x) => !x.enabled)) {
    const start = startMinutes(s);
    scenes.push({ schedule: s, day, start, end: Math.min(DAY_MINUTES, start + 30), endSet: false, quiet: isSilenceBlock(s), paused: true, shadowed: false });
  }
  return scenes.sort((a, b) => a.start - b.start);
}

export function buildWeek(schedules: Schedule[], weekDates: string[]): Scene[][] {
  return WEEK_DAYS.map((d) => buildDayScenes(schedules, d, weekDates));
}

/** what plays at `nowMin` on `day`, and what comes next that day */
export function nowAndNext(scenes: Scene[], nowMin: number): { now: Scene | null; next: Scene | null } {
  const live = scenes.filter((s) => !s.paused && !s.shadowed);
  let now: Scene | null = null;
  let next: Scene | null = null;
  for (const s of live) {
    if (s.start <= nowMin && nowMin < s.end) now = s;
    else if (s.start > nowMin && (!next || s.start < next.start)) next = s;
  }
  return { now, next };
}

/** which "days" phrase: 0..6 → label key */
export function daysKind(days: number[]): "every" | "weekdays" | "weekend" | "custom" {
  const set = new Set(days);
  if (set.size === 7) return "every";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return "weekdays";
  if (set.size === 2 && set.has(0) && set.has(6)) return "weekend";
  return "custom";
}

/** the block colours (owner 2026-11-11: "only shades of blue as the base, and let me edit and change the colour"): 8 shades of blue are the base — a block gets one of them
 *  by its music (stable) — and the owner can choose any of the 18 colours for a block. Drawn by CSS from `data-c`.
 *  0–7 blues (sky · azure · blue · royal · cobalt · navy · steel · ice) · 8 green · 9 orange · 10 purple · 11 pink · 12 teal · 13 indigo · 14 coral · 15 yellow · 16 mint · 17 graphite */
export const PALETTE_SIZE = 18;
export const BLUE_SHADES = 8;
/** the base shade of blue for a playback target: the same playlist is always the same blue */
export function paletteIndex(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h % BLUE_SHADES;
}

/** YYYY-MM-DD of a local date */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** the date `n` days after `d` (local, DST-safe) */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** a block that already exists as data, copied to a new date: the same start time, the same music, the same branch / device — one time only */
export function pastedScheduleBody(src: Schedule, dateYmd: string): Record<string, unknown> {
  return {
    name: src.name,
    branchId: src.branchId,
    targetType: src.targetType,
    targetId: (src.targetId || src.sourceId || "").trim(),
    sourceId: src.targetType === "SOURCE" ? (src.targetId || src.sourceId || "").trim() : undefined,
    deviceId: src.deviceId || undefined,
    recurrence: "one_off",
    oneOffDateLocal: dateYmd,
    daysOfWeek: [],
    startTimeLocal: src.startTimeLocal,
    ...(src.endTimeLocal && src.endTimeLocal.trim() ? { endTimeLocal: src.endTimeLocal } : {}),
    enabled: true,
    priority: typeof src.priority === "number" ? src.priority : 1,
  };
}
