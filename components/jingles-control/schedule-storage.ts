/**
 * Shared localStorage bridge for jingle schedule items.
 *
 * - The JinglesShell UI reads/writes this storage when the operator creates or
 *   removes a scheduled jingle.
 * - A root-level runtime (`JingleScheduleAutoPlayer`) polls this storage and
 *   fires the jingle (pre-roll bell → jingle URL) when its due time arrives.
 *
 * Keeping the key + shape + helpers in one module prevents drift between the
 * producer (UI) and the consumer (runtime). This is deliberately localStorage-
 * only (no API round-trip): in the desktop Electron build both live in the
 * same Chromium profile and survive app restarts.
 */

import type { MockScheduleItem } from "./types";

export const JINGLE_SCHEDULE_STORAGE_KEY = "syncbiz:jingle-schedule";
/** Cross-tab / cross-component change notification channel. */
export const JINGLE_SCHEDULE_EVENT = "syncbiz:jingle-schedule-changed";

/** Load schedule items from localStorage. Returns [] for missing/invalid data. */
export function loadJingleSchedule(): MockScheduleItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(JINGLE_SCHEDULE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is MockScheduleItem =>
        !!x &&
        typeof x === "object" &&
        typeof (x as MockScheduleItem).id === "string" &&
        typeof (x as MockScheduleItem).label === "string",
    );
  } catch {
    return [];
  }
}

export function persistJingleSchedule(items: MockScheduleItem[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(JINGLE_SCHEDULE_STORAGE_KEY, JSON.stringify(items));
    // Notify same-tab listeners (storage event only fires cross-tab).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(JINGLE_SCHEDULE_EVENT));
    }
  } catch {
    /* quota — ignore */
  }
}

/**
 * Compute the next firing timestamp (ms) for an item, or null if it is a
 * "once" item whose scheduledAtIso is already in the past.
 *
 * For repeating items (daily/weekly), walks forward from the stored
 * `scheduledAtIso` until we land strictly in the future relative to `now`.
 */
export function nextFiringMs(item: MockScheduleItem, now: number): number | null {
  const iso = item.scheduledAtIso;
  if (!iso) return null;
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) return null;

  const repeat = item.repeat ?? "once";
  if (repeat === "once") return base > now ? base : null;

  const step = repeat === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  let t = base;
  // Fast-forward in whole periods when the stored date is far in the past.
  if (t <= now) {
    const periods = Math.ceil((now - t) / step);
    t = base + periods * step;
    if (t <= now) t += step;
  }
  return t;
}
