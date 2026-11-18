/**
 * THE DAY BOARD's pure rules (components/vm/vm-day-board.tsx) — no React, so a test can run them: the dates the board moves between and where a block is drawn.
 */
import type { Scene } from "@/lib/schedules-timeline";

/** pixels per minute: an hour is 54 px (a half-hour block is still readable) */
export const PX_PER_MIN = 0.9;

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

export type BoardBlock = { scene: Scene; top: number; height: number };

/** pure: where every block is drawn (a minimum height so a short block can still be read and pressed) */
export function boardLayout(scenes: readonly Scene[], ppm: number = PX_PER_MIN): BoardBlock[] {
  return scenes.map((scene) => ({ scene, top: scene.start * ppm, height: Math.max(26, (scene.end - scene.start) * ppm - 4) }));
}

