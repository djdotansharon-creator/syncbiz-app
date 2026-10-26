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
 *
 * BRANCH-SCOPED (F4, owner 2026-10-24): one browser profile can have tabs on different branches (the browser's
 * branch is `vono-control-branch`, the desktop's is MAIN's config — see lib/station-branch.ts), so every list is
 * stored per branch. The legacy "default" branch keeps the ORIGINAL key → no migration; the existing Lenovo and every
 * single-branch screen read exactly what they read before.
 */

import type { MockScheduleItem } from "./types";

export const JINGLE_SCHEDULE_STORAGE_KEY = "syncbiz:jingle-schedule";
/** Cross-tab / cross-component change notification channel. */
export const JINGLE_SCHEDULE_EVENT = "syncbiz:jingle-schedule-changed";
const LEGACY_BRANCH = "default";
const FIRE_STATE_PREFIX = "syncbiz:jingle-fire-state:";

/** Storage key of a branch's schedule ("default" = the original, unscoped key). */
export function jingleScheduleKey(branchId: string): string {
  return branchId === LEGACY_BRANCH ? JINGLE_SCHEDULE_STORAGE_KEY : `${JINGLE_SCHEDULE_STORAGE_KEY}:${branchId}`;
}

/** Load a branch's schedule items from localStorage. Returns [] for missing/invalid data. */
export function loadJingleSchedule(branchId: string): MockScheduleItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(jingleScheduleKey(branchId));
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

export function persistJingleSchedule(branchId: string, items: MockScheduleItem[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(jingleScheduleKey(branchId), JSON.stringify(items));
    // Notify same-tab listeners (storage event only fires cross-tab).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(JINGLE_SCHEDULE_EVENT));
    }
  } catch {
    /* quota — ignore */
  }
}

/**
 * Delivery bookkeeping shared by every tab of the branch, so a scheduler tab that closes or reloads while a due
 * jingle waits for a MASTER hands the delivery to the next scheduler tab — never dropped, never sent twice.
 * - pending: occurrences that are due and not yet delivered;
 * - claimed: itemId → the last occurrence (ms) already taken into `pending` (or delivered).
 */
export type PendingJingle = { occ: string; itemId: string; dueAt: number };
export type JingleFireState = { pending: PendingJingle[]; claimed: Record<string, number> };

export function loadFireState(branchId: string): JingleFireState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(FIRE_STATE_PREFIX + branchId) : null;
    const v = raw ? (JSON.parse(raw) as Partial<JingleFireState>) : null;
    return {
      pending: Array.isArray(v?.pending) ? v!.pending.filter((p) => p && typeof p.occ === "string" && typeof p.dueAt === "number") : [],
      claimed: v?.claimed && typeof v.claimed === "object" ? (v.claimed as Record<string, number>) : {},
    };
  } catch {
    return { pending: [], claimed: {} };
  }
}

export function saveFireState(branchId: string, state: JingleFireState): void {
  try {
    localStorage.setItem(FIRE_STATE_PREFIX + branchId, JSON.stringify(state));
  } catch {
    /* quota — ignore */
  }
}

function periodMs(item: MockScheduleItem): number | null {
  const repeat = item.repeat ?? "once";
  if (repeat === "once") return null;
  return repeat === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
}

/** The latest occurrence at or before `now` (ms), or null if none yet. */
export function lastFiringMs(item: MockScheduleItem, now: number): number | null {
  const base = item.scheduledAtIso ? Date.parse(item.scheduledAtIso) : NaN;
  if (!Number.isFinite(base) || base > now) return null;
  const step = periodMs(item);
  if (step === null) return base;
  return base + Math.floor((now - base) / step) * step;
}

/**
 * Compute the next firing timestamp (ms) for an item, or null if it is a
 * "once" item whose scheduledAtIso is already in the past.
 *
 * For repeating items (daily/weekly), walks forward from the stored
 * `scheduledAtIso` until we land strictly in the future relative to `now`.
 */
export function nextFiringMs(item: MockScheduleItem, now: number): number | null {
  // fixed days of the week at a time of day (the queue's Jingles scheduler): the first matching day/time after `now`
  if (item.repeat === "weekdays") {
    const days = item.days && item.days.length > 0 ? item.days : [0, 1, 2, 3, 4, 5, 6];
    const [hh, mm] = (item.timeOfDay ?? "00:00").split(":").map((n) => parseInt(n, 10));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    for (let add = 0; add < 8; add++) {
      const d = new Date(now);
      d.setDate(d.getDate() + add);
      d.setHours(hh, mm, 0, 0);
      if (days.includes(d.getDay()) && d.getTime() > now) return d.getTime();
    }
    return null;
  }
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
