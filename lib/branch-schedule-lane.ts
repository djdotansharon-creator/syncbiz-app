/**
 * CONTROL ROOM — the Schedule section of a branch (owner 2026-11-25, "send a day to my other branches", phase 2: the screens). PURE: no React, no fetch, no clock (callers pass `now`).
 *
 * What is here: the small read-only LANE of one day (drawn with the Studio's own `buildDayScenes`, so the times are exactly the engine's), the same lane for an OFFER's snapshot, the
 * weekday / date helpers, and the plain-word text for the server's refusals. Nothing here writes anything.
 *
 * The lane draws the WEEKLY routine of a weekday — the same blocks the send carries (`blocksOfDay` in lib/schedule-day-share-rules.ts: enabled, weekly) — so "7 fit, 2 can't be placed" matches what is drawn.
 * One-time blocks of a date and "off for one date" marks are therefore not part of it (no dates are passed to `buildDayScenes`).
 */
import type { Schedule } from "@/lib/types";
import { buildDayScenes, DAY_MINUTES, formatMinutes } from "@/lib/schedules-timeline";
import { isSilenceBlock } from "@/lib/schedule-actions";
import { CLOSING_BLOCK_NAME, DAY_SHARE_LIMITS, SKIP_REASON_TEXT, type SkippedBlock, type SnapshotBlock } from "@/lib/schedule-day-share-rules";

export const WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** `buildDayScenes` places a one-time block / an "off for one date" mark by DATE — a date that never matches keeps only the weekly routine */
const NO_DATES: string[] = ["", "", "", "", "", "", ""];

export type LaneBlock = {
  key: string;
  /** minutes from midnight */
  start: number;
  end: number;
  name: string;
  quiet: boolean;
  closing: boolean;
  /** 0..7 — the tone of a music block (the same hash the Studio uses is not needed: a stable pick by name keeps one playlist one colour) */
  tone: number;
  /** what the block plays (PLAYLIST / BANK / SILENCE …) and its id — the offer screen looks the playlist's cover up by it */
  targetType: string;
  targetId: string;
};

const toneOf = (key: string): number => {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h % 8;
};

/** the weekly routine of one weekday as lane blocks — `nameOf` gives a music block its name (the caller knows the library), quiet blocks are named here */
export function laneBlocks(schedules: Schedule[], weekday: number, nameOf: (s: Schedule) => string, labels: { quiet: string; closing: string }): LaneBlock[] {
  return buildDayScenes(schedules, weekday, NO_DATES)
    .filter((sc) => !sc.paused && !sc.shadowed)
    .map((sc) => {
      const quiet = isSilenceBlock(sc.schedule);
      const closing = quiet && (sc.schedule.name ?? "").trim() === CLOSING_BLOCK_NAME;
      const name = quiet ? (closing ? labels.closing : labels.quiet) : nameOf(sc.schedule);
      return { key: sc.schedule.id, start: sc.start, end: Math.min(DAY_MINUTES, Math.max(sc.start + 1, sc.end)), name, quiet, closing, tone: toneOf(sc.schedule.targetId || name), targetType: sc.schedule.targetType, targetId: sc.schedule.targetId };
    });
}

/** an offer's blocks (the whitelisted snapshot) as schedule rows, so the SAME drawing code draws them — never sent anywhere, never written */
export function snapshotSchedules(blocks: SnapshotBlock[], weekday: number): Schedule[] {
  return blocks.map((b, i) => ({
    id: `offer-${i}`,
    accountId: "",
    name: b.target.type === "SILENCE" ? "" : b.name ?? b.target.name,
    branchId: "",
    targetType: b.target.type,
    targetId: b.target.id,
    recurrence: "weekly" as const,
    daysOfWeek: [weekday],
    startTimeLocal: b.time,
    endTimeLocal: b.end,
    enabled: true,
    priority: b.priority,
    volume: b.volume,
  }));
}

/** the lane of an offer — a music block is named by the playlist / bank it plays (as the Studio does), else by the block's own name */
export function snapshotLane(blocks: SnapshotBlock[], weekday: number, labels: { quiet: string; closing: string }): LaneBlock[] {
  const byId = new Map(blocks.map((b, i) => [`offer-${i}`, b]));
  return laneBlocks(snapshotSchedules(blocks, weekday), weekday, (s) => byId.get(s.id)?.target.name ?? s.name ?? "", labels);
}

/** the hours the lane covers: from the hour of the first block to the end of the last one (at least four hours) */
export function laneRange(blocks: LaneBlock[]): { first: number; last: number } {
  if (blocks.length === 0) return { first: 8 * 60, last: 20 * 60 };
  const lo = Math.min(...blocks.map((b) => b.start));
  const hi = Math.max(...blocks.map((b) => b.end));
  let first = Math.floor(lo / 60) * 60;
  let last = Math.min(DAY_MINUTES, Math.ceil(hi / 60) * 60);
  if (last - first < 240) {
    last = Math.min(DAY_MINUTES, first + 240);
    first = Math.max(0, last - 240);
  }
  return { first, last };
}

/** where a block sits in the lane, in percent of its width */
export function laneBox(b: Pick<LaneBlock, "start" | "end">, r: { first: number; last: number }): { left: number; width: number } {
  const span = Math.max(1, r.last - r.first);
  const left = ((Math.max(b.start, r.first) - r.first) / span) * 100;
  const right = ((Math.min(b.end, r.last) - r.first) / span) * 100;
  return { left, width: Math.max(0, right - left) };
}

/** "08:00 – 12:00" for a block (an end of midnight reads 24:00) */
export function laneTimes(b: Pick<LaneBlock, "start" | "end">): string {
  return `${formatMinutes(b.start)} – ${b.end >= DAY_MINUTES ? "24:00" : formatMinutes(b.end)}`;
}

// ── dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const p2 = (n: number) => String(n).padStart(2, "0");
/** today as YYYY-MM-DD on this computer's clock — the lowest date the date picker allows (the server refuses a past date) */
export const todayYmd = (now: Date): string => `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
/** the weekday (0 = Sunday) of a YYYY-MM-DD date, from its parts (no time zone involved) */
export function weekdayOfDate(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay();
}

/** the first date from today on (today included) that falls on `weekday` — the date a "one day only" choice starts from */
export function nextDateOfWeekday(now: Date, weekday: number): string {
  const ahead = (weekday - now.getDay() + 7) % 7;
  return todayYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead));
}

// ── the offers ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** a cover is a web address, an inline image or a path on this site — never a file path of a computer, never a protocol-relative address (CLAUDE.md §12) */
export const isSafeCover = (c: unknown): c is string => typeof c === "string" && /^(https?:\/\/|data:image\/|\/(?!\/))/i.test(c.trim());

/** how many blocks a branch already has on the days an offer would land on (a weekly routine on those weekdays, or what runs on that date) — active blocks only */
export function ownBlocksOn(
  items: readonly Pick<Schedule, "enabled" | "recurrence" | "daysOfWeek" | "oneOffDateLocal" | "skipDates">[],
  c: { mode: "weekday"; weekdays: readonly number[] } | { mode: "date"; date: string } | null,
): number {
  if (!c) return 0;
  const live = items.filter((s) => s.enabled);
  if (c.mode === "weekday") return live.filter((s) => s.recurrence !== "one_off" && Array.isArray(s.daysOfWeek) && s.daysOfWeek.some((d) => c.weekdays.includes(d))).length;
  const wd = weekdayOfDate(c.date);
  return live.filter((s) => (s.recurrence === "one_off" ? s.oneOffDateLocal === c.date : Array.isArray(s.daysOfWeek) && s.daysOfWeek.includes(wd) && !(s.skipDates ?? []).includes(c.date))).length;
}

/** the blocks of an offer that could not be placed — "the branch keeps its own closing" is not a failure, so it is not listed */
export const cannotBePlaced = (skipped: readonly SkippedBlock[]): SkippedBlock[] => skipped.filter((s) => s.reason !== "closing-kept");

/** the plain-words reason of a skipped block (the server's own wording — the screens translate it) */
export const reasonText = (s: Pick<SkippedBlock, "reason">): string => SKIP_REASON_TEXT[s.reason] ?? SKIP_REASON_TEXT.unsupported;

/** accepted offers that can still be undone (the server's `undoableUntil` is in the future), newest first */
export function undoableOffers<T extends { undoableUntil: string | null; decidedAt: string | null }>(offers: readonly T[], now: Date): T[] {
  return offers
    .filter((o) => !!o.undoableUntil && new Date(o.undoableUntil).getTime() > now.getTime())
    .sort((a, b) => new Date(b.decidedAt ?? 0).getTime() - new Date(a.decidedAt ?? 0).getTime());
}

/** one fresh id per send click — a retry of the same click (a double click, a slow network) is the same send on the server */
export function newRequestId(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `ds-${c.randomUUID()}`;
  return `ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The server's refusal in words a person can read. The server's own sentence is kept when the screens know it (they translate it); anything else becomes one calm line by status.
 * Returns an English text — the caller runs it through `tr`.
 */
export const KNOWN_ERRORS: readonly string[] = [
  "Only an owner of the business can send a day of a schedule to other branches",
  "Forbidden: no access to this branch",
  "Too many sends in a short time. Try again later.",
  "Too many requests. Try again later.",
  "No branch to send to",
  "Nothing in this day can be placed on another branch",
  "Nothing in this offer can be placed on this branch",
  "This offer has expired",
  "This offer is not waiting for an answer",
  "The sender took this offer back",
  "This offer is already closed",
  "There is nothing to undo",
  "That date is in the past",
  "Choose a calendar date",
  "Offer not found",
  "Branch not found",
];

/** one send goes to at most this many branches — said in words (the server's own cap, DAY_SHARE_LIMITS.MAX_TARGET_BRANCHES) */
export const SEND_CAP_TEXT = `You can send to up to ${DAY_SHARE_LIMITS.MAX_TARGET_BRANCHES} branches at once.`;

export function errorText(status: number, serverError: string | null | undefined): string {
  const e = (serverError ?? "").trim();
  if (e && KNOWN_ERRORS.includes(e)) return e;
  if (/^The \d+-day window for undoing/.test(e)) return "The time for undoing this is over";
  if (/^A day of more than \d+ blocks/.test(e)) return "This day is too big to send";
  if (/^A day can be sent to at most/.test(e)) return SEND_CAP_TEXT;
  if (status === 429) return "Too many requests. Try again later.";
  if (status === 401) return "Your session ended. Sign in again.";
  if (status === 403) return "You don't have permission to do this.";
  if (status === 404) return "This is no longer there.";
  if (status === 409 || status === 410) return "This offer is no longer open.";
  if (status === 0) return "No connection. Try again.";
  return "Something went wrong. Try again.";
}
