/**
 * THE PHONE'S SCHEDULE — the date rules (components/vm/vm-schedule.tsx): a local date as a key, the day after / before. No React, so a test can run them.
 * (2026-11-20: the pixel-per-minute board that used to live here was replaced by the week strip + the list of blocks — lib/mobile-schedule.ts.)
 */

export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** a local date as 2026-11-18 (what a date input carries) */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 2026-11-18 → that day at local noon (noon, so no summer-time shift can move it to the next day); null when it is not a date */
export function parseDateKey(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Number.isNaN(d.getTime()) || dateKey(d) !== s ? null : d;
}

/** the day `n` days after (or before) `d` */
export function shiftDay(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0);
}
