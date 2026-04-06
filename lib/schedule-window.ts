import type { Schedule } from "@/lib/types";

/** Minutes from midnight (local), 0–1439. Seconds in string are ignored (floor to minute). */
export function parseLocalTimeToMinutes(s: string): number {
  const t = (s ?? "").trim();
  if (!t) return 0;
  const parts = t.split(":");
  const h = Math.min(23, Math.max(0, parseInt(parts[0] ?? "0", 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(parts[1] ?? "0", 10) || 0));
  return h * 60 + m;
}

function minutesNow(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function localDateYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Lower number = higher priority (1 before 5). */
export function numericSchedulePriority(s: Schedule): number {
  const p = s.priority;
  if (typeof p === "number" && !Number.isNaN(p)) return p;
  const n = parseInt(String(p), 10);
  return Number.isNaN(n) ? 999 : n;
}

/**
 * True when `now` falls in [start, end] on the correct calendar day / weekday.
 * Supports overnight windows (e.g. 22:00–02:00).
 */
export function isScheduleInActiveWindow(schedule: Schedule, now: Date): boolean {
  if (!schedule.enabled) return false;

  if (schedule.recurrence === "one_off") {
    const od = (schedule.oneOffDateLocal ?? "").trim();
    if (!od || !/^\d{4}-\d{2}-\d{2}$/.test(od)) return false;
    if (localDateYmd(now) !== od) return false;
  } else {
    const dow = now.getDay();
    if (!Array.isArray(schedule.daysOfWeek) || !schedule.daysOfWeek.includes(dow)) {
      return false;
    }
  }

  const cur = minutesNow(now);
  const start = parseLocalTimeToMinutes(schedule.startTimeLocal);
  /** Empty / missing end = end of day (API should store 23:59; tolerate bad "" saves). */
  const endRaw = (schedule.endTimeLocal ?? "").trim();
  const end =
    endRaw.length === 0 ? 23 * 60 + 59 : parseLocalTimeToMinutes(schedule.endTimeLocal);

  if (end < start) {
    return cur >= start || cur <= end;
  }
  return cur >= start && cur <= end;
}

/** Among enabled schedules active at `now`, pick by lowest priority number, then id. */
export function pickWinningScheduleForNow(
  schedules: Schedule[],
  now: Date,
  opts?: { skipScheduleIds?: Set<string> },
): Schedule | null {
  const skip = opts?.skipScheduleIds;
  const active = schedules.filter(
    (s) => !skip?.has(s.id) && isScheduleInActiveWindow(s, now),
  );
  if (active.length === 0) return null;
  active.sort((a, b) => {
    const pa = numericSchedulePriority(a);
    const pb = numericSchedulePriority(b);
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
  return active[0] ?? null;
}

/** Stable key: one auto-start per schedule per local day + start time. */
export function scheduleAutoFireStorageKey(schedule: Schedule, now: Date): string {
  return `syncbiz-schedule-auto-${schedule.id}-${localDateYmd(now)}-${schedule.startTimeLocal}`;
}
