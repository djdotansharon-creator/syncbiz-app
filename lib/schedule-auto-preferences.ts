/**
 * Per-schedule opt-out from automatic playback (browser-local).
 * Global master toggle still must be on; this only excludes specific blocks.
 */

const OPT_OUT_IDS_KEY = "syncbiz-schedule-auto-off-ids";

function parseIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function getScheduleAutoOptOutIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  return parseIds(localStorage.getItem(OPT_OUT_IDS_KEY));
}

export function isScheduleAutoPlaybackOff(scheduleId: string): boolean {
  return getScheduleAutoOptOutIds().has(scheduleId);
}

/** true = opted out (this block will not auto-start). */
export function setScheduleAutoPlaybackOff(scheduleId: string, off: boolean): void {
  const next = getScheduleAutoOptOutIds();
  if (off) next.add(scheduleId);
  else next.delete(scheduleId);
  try {
    localStorage.setItem(OPT_OUT_IDS_KEY, JSON.stringify([...next]));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("syncbiz-schedule-auto-prefs"));
}

export const SCHEDULE_AUTO_PREFS_EVENT = "syncbiz-schedule-auto-prefs";
