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
import { isSkippedOn } from "@/lib/schedule-skip";

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
  /** the block is switched on in general but OFF for this one date (owner 2026-11-18, lib/schedule-skip.ts): drawn like a paused block, and the block before it carries on */
  offDay?: boolean;
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
/**
 * `musicMinutes` (owner 2026-11-15: "a song cannot be stretched beyond what it is"): how long a block's own music lasts, in whole minutes (null = not known / live). A block with no
 * end of its own is then drawn only as long as its music — what follows until the next block is not the block's: the player fills it with suggested songs (lib/schedule-driven.ts).
 */
export function buildDayScenes(schedules: Schedule[], day: number, weekDates: string[], musicMinutes?: (s: Schedule) => number | null, floatingId?: string): Scene[] {
  const mine = schedules.filter((s) => appliesOnDay(s, day, weekDates));
  const dateOfDay = weekDates[day];
  const offToday = (s: Schedule): boolean => isSkippedOn(s, dateOfDay);
  // a block that is being CARRIED (owner 2026-11-15) is not part of the sequence: it floats above the others, keeps its own length (a block next to it never cuts it short, and it never
  // cuts the others short), and what it covers is only its own stretch
  const floating = floatingId ? mine.find((s) => s.id === floatingId && s.enabled) : undefined;
  const active = mine
    .filter((s) => s.enabled && !offToday(s) && s.id !== floatingId)
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
    const own = explicitEndMinutes(s); // a quiet block can have its own end too (owner 2026-11-15: "I want to control the quiet time with the two bars")
    let end = own !== null && own < nextStart ? own : nextStart;
    if (own === null && !quiet && musicMinutes) {
      const len = musicMinutes(s);
      if (len !== null && len > 0 && start + len < end) end = start + len;
    }
    const shadowed = seen.has(start);
    seen.add(start);
    scenes.push({ schedule: s, day, start, end, endSet: own !== null && own <= nextStart, quiet, paused: false, shadowed });
  }
  for (const s of mine.filter((x) => !x.enabled || offToday(x))) {
    const start = startMinutes(s);
    scenes.push({ schedule: s, day, start, end: Math.min(DAY_MINUTES, start + 30), endSet: false, quiet: isSilenceBlock(s), paused: true, shadowed: false, ...(s.enabled ? { offDay: true } : {}) });
  }
  if (floating) {
    const start = startMinutes(floating);
    const quiet = isSilenceBlock(floating);
    const own = explicitEndMinutes(floating);
    const nextDistinct = distinct.find((m) => m > start);
    let end = own ?? (nextDistinct ?? DAY_MINUTES);
    if (own === null && !quiet && musicMinutes) {
      const len = musicMinutes(floating);
      if (len !== null && len > 0) end = start + len;
    }
    // never shorter than a minute (owner 2026-11-17): it used to be 5 minutes, so while a song's block was being CUT below 5 minutes it stayed drawn at 5 and only jumped to its true length after the
    // mouse was let go — "it does not move with my mouse, the reaction comes late". The strips cut down to a minute (once the hours are zoomed far enough to aim at one), so the drawing follows.
    scenes.push({ schedule: floating, day, start, end: Math.min(DAY_MINUTES, Math.max(start + 1, end)), endSet: own !== null, quiet, paused: false, shadowed: false });
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
    ...(typeof src.volume === "number" ? { volume: src.volume } : {}), // a copy keeps the volume the block was given
  };
}

/** a scheduled jingle, as the Jingles screen keeps it (components/jingles-control/types.ts → MockScheduleItem) — only what the schedule needs to place it */
export type JingleLike = {
  id: string;
  label: string;
  repeat?: "once" | "daily" | "weekly" | "weekdays";
  /** repeat "weekdays": the days of the week (0 = Sunday), empty = every day */
  days?: number[];
  /** repeat "weekdays": local "HH:MM" */
  timeOfDay?: string;
  /** the first (or only) firing, an ISO date-time; its local time of day is the time of a daily / weekly / once jingle */
  scheduledAtIso?: string;
};

/** at what minute of `date` (a local day) does this jingle fire — or null when it does not fire that day. A jingle is a moment, not a stretch: it plays ON TOP of the music. */
export function jingleMinutesOn(item: JingleLike, date: Date): number | null {
  const repeat = item.repeat ?? "once";
  if (repeat === "weekdays") {
    const days = item.days && item.days.length > 0 ? item.days : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(date.getDay())) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec((item.timeOfDay ?? "").trim());
    if (!m) return null;
    const h = parseInt(m[1]!, 10);
    const min = parseInt(m[2]!, 10);
    return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? h * 60 + min : null;
  }
  const base = item.scheduledAtIso ? new Date(item.scheduledAtIso) : null;
  if (!base || Number.isNaN(base.getTime())) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (startOfDay(date) < startOfDay(base)) return null; // it has not started yet
  const at = base.getHours() * 60 + base.getMinutes();
  if (repeat === "daily") return at;
  if (repeat === "weekly") return date.getDay() === base.getDay() ? at : null;
  return startOfDay(date) === startOfDay(base) ? at : null;
}

/** the jingles that fire on `date`, in time order */
export function jinglesOnDay(list: JingleLike[], date: Date): { item: JingleLike; min: number }[] {
  const out: { item: JingleLike; min: number }[] = [];
  for (const item of list) {
    const min = jingleMinutesOn(item, date);
    if (min !== null) out.push({ item, min });
  }
  return out.sort((a, b) => a.min - b.min || a.item.id.localeCompare(b.item.id));
}

// ───────────── how the blocks look (owner 2026-11-12: "settings for this" — colour from the cover or one colour's shades; where the text / image sit; times; length) ─────────────

export type BlockColourMode = "palette" | "cover";
export type ColourFamily = "blue" | "violet" | "teal" | "green" | "rose" | "orange" | "graphite";
export type BlockContent = "both" | "text" | "image";
export type BlockPosition = "top" | "middle" | "bottom";
/** "fog": the song's picture fades into black / white and the details sit in the solid part; "solid": a colour block with the picture as a small square */
export type BlockStyle = "fog" | "solid";
/** the week as seven wide ROWS (the days down, the hours across — the pictures keep their shape) or as seven tall COLUMNS (the classic calendar) */
export type WeekLayout = "rows" | "columns";
/** which hours the timeline shows: "active" = the business's own hours (or, when none are set, the stretch the schedule uses); "day" = the whole 24 hours */
export type HoursMode = "active" | "day";
export type StudioDisplay = {
  style: BlockStyle;
  weekLayout: WeekLayout;
  hours: HoursMode;
  /** "palette": shades of ONE colour (a block gets its shade by its music); "cover": the colour of the song's own picture */
  colour: BlockColourMode;
  family: ColourFamily;
  content: BlockContent;
  pos: BlockPosition;
  /** the start – end hours in the block */
  times: boolean;
  /** how long the song / playlist itself is (when known) */
  length: boolean;
};
/** the default: fog blocks (the picture melting into black / white with the details below), the picture and the name and the hours, no length, shades of blue (for solid blocks and music without a picture) */
export const DEFAULT_DISPLAY: StudioDisplay = { style: "fog", weekLayout: "rows", hours: "active", colour: "palette", family: "blue", content: "both", pos: "top", times: true, length: false };
export const COLOUR_FAMILIES: ColourFamily[] = ["blue", "violet", "teal", "green", "rose", "orange", "graphite"];

/** whatever was stored → a valid setting (anything unknown falls back to the default, field by field) */
export function parseDisplay(raw: unknown): StudioDisplay {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (typeof v === "string" && (ok as readonly string[]).includes(v) ? (v as T) : d);
  return {
    style: pick(o.style, ["fog", "solid"], DEFAULT_DISPLAY.style),
    weekLayout: pick(o.weekLayout, ["rows", "columns"], DEFAULT_DISPLAY.weekLayout),
    hours: pick(o.hours, ["active", "day"], DEFAULT_DISPLAY.hours),
    colour: pick(o.colour, ["palette", "cover"], DEFAULT_DISPLAY.colour),
    family: pick(o.family, COLOUR_FAMILIES, DEFAULT_DISPLAY.family),
    content: pick(o.content, ["both", "text", "image"], DEFAULT_DISPLAY.content),
    pos: pick(o.pos, ["top", "middle", "bottom"], DEFAULT_DISPLAY.pos),
    times: typeof o.times === "boolean" ? o.times : DEFAULT_DISPLAY.times,
    length: typeof o.length === "boolean" ? o.length : DEFAULT_DISPLAY.length,
  };
}

/** 225 → "3:45", 3900 → "1:05:00" (the same way a player shows a total time) */
export function formatLength(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(ss)}` : `${m}:${pad2(ss)}`;
}

export type BlockTone = { c1: string; c2: string };

function hsl(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hh / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** [hue, saturation 0–1] of each colour family (blue is the CSS palette itself, data-c 0–7) */
const FAMILY_HS: Record<Exclude<ColourFamily, "blue">, [number, number]> = {
  violet: [268, 0.6],
  teal: [180, 0.58],
  green: [142, 0.5],
  rose: [338, 0.66],
  orange: [27, 0.82],
  graphite: [220, 0.07],
};

/** shade `i` (0–7, a block's stable shade) of a colour family; null for blue = use the CSS palette (data-c = i) */
export function familyShade(family: ColourFamily, i: number): BlockTone | null {
  if (family === "blue") return null;
  const [h, s] = FAMILY_HS[family];
  const k = Math.min(Math.max(Math.round(i), 0), BLUE_SHADES - 1);
  const hue = h + (k - 3.5) * 2.2;
  const l1 = 0.67 - k * 0.032;
  return { c1: hsl(hue, s, l1), c2: hsl(hue, Math.min(1, s + 0.05), l1 - 0.15) };
}

/** the colour of a picture: its most vivid hue (grey pictures give a calm grey), as a light → deep pair. `data` = RGBA pixels (a small downscaled copy is enough). */
export function toneFromPixels(data: ArrayLike<number>): BlockTone | null {
  let wSum = 0;
  let sx = 0;
  let sy = 0;
  let sSum = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    const w = s * (1 - Math.abs(2 * l - 1)); // vivid and neither black nor white
    n++;
    sSum += s;
    wSum += w;
    sx += w * Math.cos((h * Math.PI) / 180);
    sy += w * Math.sin((h * Math.PI) / 180);
  }
  if (n === 0) return null;
  if (wSum / n < 0.04) return { c1: hsl(220, 0.07, 0.6), c2: hsl(220, 0.08, 0.42) }; // a grey / near-black / near-white picture
  const hue = (Math.atan2(sy, sx) * 180) / Math.PI;
  const sat = Math.min(0.8, Math.max(0.4, sSum / n + 0.1));
  return { c1: hsl(hue, sat, 0.6), c2: hsl(hue, Math.min(1, sat + 0.05), 0.42) };
}

// ───────────── business hours (owner 2026-11-12: "a business has fixed hours — a clock to set them; the timeline follows them, or shows the whole day") ─────────────

/** a day's opening hours in minutes after midnight; a close at or before the open means "until the next morning"; a close of 0 means midnight; null = closed that day */
export type DayHours = { open: number; close: number } | null;
export type BizHours = {
  /** open round the clock */
  h24: boolean;
  /** one pair of hours for every day (`all`), or each day on its own (`days`, Sunday first) */
  same: boolean;
  all: { open: number; close: number };
  days: DayHours[];
};
export const DEFAULT_BIZ_HOURS: BizHours = { h24: false, same: true, all: { open: 8 * 60, close: 22 * 60 }, days: [0, 1, 2, 3, 4, 5, 6].map(() => ({ open: 8 * 60, close: 22 * 60 })) };

const okMin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1440;

/** whatever was stored → valid business hours, or null when nothing usable was saved */
export function parseBizHours(raw: unknown): BizHours | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pair = (v: unknown): { open: number; close: number } | null => {
    if (!v || typeof v !== "object") return null;
    const p = v as Record<string, unknown>;
    return okMin(p.open) && okMin(p.close) ? { open: p.open, close: p.close } : null;
  };
  const all = pair(o.all) ?? DEFAULT_BIZ_HOURS.all;
  const days = Array.isArray(o.days) ? o.days : [];
  return {
    h24: o.h24 === true,
    same: o.same !== false,
    all,
    days: WEEK_DAYS.map((d) => (days[d] === null ? null : pair(days[d]) ?? all)),
  };
}

/** the hours of calendar day `d` (0 = Sunday) */
export function bizDay(biz: BizHours, d: number): DayHours {
  if (biz.h24) return { open: 0, close: 1440 };
  return biz.same ? biz.all : biz.days[d] ?? null;
}

const closeOf = (h: { open: number; close: number }) => (h.close === 0 ? 1440 : h.close);
const isOvernight = (h: { open: number; close: number }) => closeOf(h) <= h.open;

/** where the music goes quiet, per calendar day: the minute of that day's "Closing" (null = none). An evening that ends the next morning puts its closing on the next day;
 *  a day the business is closed goes quiet from midnight; round the clock has none. */
export function closingPlan(biz: BizHours): (number | null)[] {
  const plan: (number | null)[] = WEEK_DAYS.map(() => null);
  if (biz.h24) return plan;
  for (const d of WEEK_DAYS) {
    const h = bizDay(biz, d);
    if (h === null) {
      plan[d] = 0;
      continue;
    }
    const c = closeOf(h);
    if (isOvernight(h)) plan[(d + 1) % 7] = h.close;
    else if (c < 1440) plan[d] = c;
  }
  return plan;
}

/**
 * The hours a calendar day is OPEN, as [from, to] minute pairs inside 0–1440 (owner 2026-11-22: the Studio draws the CLOSED time between them — a quiet hatch, a thin red line where
 * the business closes, a thin green one where it opens). A night that runs past midnight is open on the next day's morning too; a closed day has none; round the clock is the whole day.
 * Pure drawing data — it creates and changes no block.
 */
export function openSpans(biz: BizHours, d: number): [number, number][] {
  if (biz.h24) return [[0, DAY_MINUTES]];
  const raw: [number, number][] = [];
  const prev = bizDay(biz, (d + 6) % 7);
  if (prev && isOvernight(prev)) raw.push([0, closeOf(prev)]); // yesterday's night, still open this morning
  const h = bizDay(biz, d);
  if (h) raw.push(isOvernight(h) ? [h.open, DAY_MINUTES] : [h.open, closeOf(h)]);
  raw.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const sp of raw) {
    if (sp[1] <= sp[0]) continue;
    const last = out[out.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else out.push([sp[0], sp[1]]);
  }
  return out;
}

/** the CLOSED time of a calendar day: what is left of 0–1440 outside `openSpans` (a day with no hours set at all is closed the whole day). */
export function closedSpans(biz: BizHours, d: number): [number, number][] {
  const open = openSpans(biz, d);
  const out: [number, number][] = [];
  let at = 0;
  for (const [a, b] of open) {
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < DAY_MINUTES) out.push([at, DAY_MINUTES]);
  return out;
}

/** the minutes of a day where the business CLOSES (an open span ends before midnight) and where it OPENS (an open span starts after midnight). */
export function bizEdges(biz: BizHours, d: number): { closes: number[]; opens: number[] } {
  const open = openSpans(biz, d);
  return { closes: open.filter(([, b]) => b < DAY_MINUTES).map(([, b]) => b), opens: open.filter(([a]) => a > 0).map(([a]) => a) };
}

/** the hours the timeline shows: [first, last] in whole hours (0–24). `starts` = the start minutes of the scheduled blocks, so nothing scheduled is ever hidden. */
export function viewRange(mode: HoursMode, biz: BizHours | null, starts: number[], ends: number[] = []): { first: number; last: number } {
  if (mode === "day") return { first: 0, last: 24 };
  let first: number;
  let last: number;
  const open = biz ? WEEK_DAYS.map((d) => bizDay(biz, d)).filter((h): h is { open: number; close: number } => h !== null) : [];
  if (biz && (biz.h24 || open.some(isOvernight))) return { first: 0, last: 24 };
  if (open.length > 0) {
    // ACTIVE HOURS = the business's own hours and nothing else (owner 2026-11-16): the closing marker, and whatever is scheduled outside the hours, are for the "Full day" view — this is also the
    // furthest the hours can be stretched / zoomed out to
    first = Math.floor(Math.min(...open.map((h) => h.open)) / 60);
    last = Math.min(24, Math.ceil(Math.max(...open.map(closeOf)) / 60));
    return thinnest(first, last);
  } else if (starts.length > 0) {
    first = Math.floor(Math.min(...starts) / 60) - 1;
    last = Math.ceil(Math.max(...starts) / 60) + 2;
  } else {
    first = 8;
    last = 22;
  }
  if (starts.length > 0) {
    first = Math.min(first, Math.floor(Math.min(...starts) / 60));
    last = Math.max(last, Math.min(24, Math.ceil(Math.max(...starts) / 60) + 1));
  }
  // the END of a block is part of what is scheduled too (a block that starts at 10:00 and ends at 16:45 must not be cut at 13:00)
  if (ends.length > 0) last = Math.max(last, Math.min(24, Math.ceil(Math.max(...ends) / 60) + 1)); // + 1 hour of room, so a long block can still be carried later
  return thinnest(first, last);
}

/** whole hours inside the day, never thinner than eight hours */
function thinnest(first: number, last: number): { first: number; last: number } {
  first = Math.max(0, first);
  last = Math.min(24, last);
  while (last - first < 8) {
    if (first > 0) first -= 1;
    if (last - first < 8 && last < 24) last += 1;
    if (first === 0 && last === 24) break;
  }
  return { first, last };
}

// ───────────────────────── zooming + panning the hours (owner 2026-11-12: "like the timeline of After Effects / the scale of Apple Maps") ─────────────────────────

/** the part of the day the timeline shows, in minutes after midnight */
export type TimeWindow = { a: number; b: number };
/** the closest a person can zoom: the whole timeline then shows this many minutes */
export const MIN_WINDOW_MINUTES = 20;

/** zoom a window by `factor` (below 1 = closer, above 1 = further) around the point under the pointer (`anchorRatio`: 0 = left edge … 1 = right edge); the result stays inside the day */
export function zoomWindow(w: TimeWindow, factor: number, anchorRatio: number): TimeWindow {
  const width = w.b - w.a;
  const next = Math.min(DAY_MINUTES, Math.max(MIN_WINDOW_MINUTES, width * factor));
  const ratio = Math.min(1, Math.max(0, anchorRatio));
  const a = Math.min(Math.max(0, w.a + ratio * width - ratio * next), DAY_MINUTES - next);
  return { a, b: a + next };
}

/** keep a window inside `bounds` (the hours the timeline shows): never wider than them, never sliding out of them */
export function clampWindow(w: TimeWindow, bounds: TimeWindow): TimeWindow {
  const room = bounds.b - bounds.a;
  const width = Math.min(room, Math.max(0, w.b - w.a));
  const a = Math.min(Math.max(bounds.a, w.a), bounds.b - width);
  return { a, b: a + width };
}

/** slide a window along the day by some minutes (its width stays) */
export function panWindow(w: TimeWindow, deltaMinutes: number): TimeWindow {
  const width = w.b - w.a;
  const a = Math.min(Math.max(0, w.a + deltaMinutes), DAY_MINUTES - width);
  return { a, b: a + width };
}

const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360];
/** the gap between two hour labels, in minutes: the smallest nice step that leaves at least `minPx` of room between labels */
export function tickStep(pxPerMin: number, minPx = 52): number {
  for (const s of TICK_STEPS) if (s * pxPerMin >= minPx) return s;
  return TICK_STEPS[TICK_STEPS.length - 1]!;
}

/** the labelled minutes inside a window: every multiple of `step` from its left edge up to (not including) its right edge */
export function windowTicks(w: TimeWindow, step: number): number[] {
  const out: number[] = [];
  for (let m = Math.ceil(w.a / step - 1e-9) * step; m < w.b - 1e-6 && m < DAY_MINUTES; m += step) out.push(m);
  return out;
}

const SCALE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720];
/** a scale bar like the one on a map: the longest nice length of time that fits in `maxPx`, and how wide it is on screen */
export function scaleBar(pxPerMin: number, maxPx = 92): { minutes: number; px: number } {
  let minutes = SCALE_STEPS[0]!;
  for (const s of SCALE_STEPS) if (s * pxPerMin <= maxPx) minutes = s;
  return { minutes, px: Math.round(minutes * pxPerMin) };
}

// ───────────────────────── swapping two blocks (owner 2026-11-12: "swap songs like icons on a phone — without moving the others") ─────────────────────────

/**
 * Where two blocks start after they swap places. The earlier block moves back by exactly the later block's length (the gap between them is kept), the later one
 * takes the earlier one's start — so the stretch of day the two cover together (and everything outside it) stays exactly as it was. Lengths are the blocks' own
 * (what is drawn: the stored end, or until the next block).
 */
export function swapStarts(a: { start: number; end: number }, b: { start: number; end: number }): { a: number; b: number } {
  if (a.start === b.start) return { a: a.start, b: b.start };
  const aFirst = a.start < b.start;
  const first = aFirst ? a : b;
  const second = aFirst ? b : a;
  const gap = Math.max(0, second.start - first.end);
  const secondLen = second.end - second.start;
  const firstNew = Math.min(DAY_MINUTES - 5, first.start + secondLen + gap);
  const secondNew = first.start;
  return aFirst ? { a: firstNew, b: secondNew } : { a: secondNew, b: firstNew };
}

/**
 * The carried block `a` (length `aLen`) is held at `aAt`, and has passed the middle of the neighbour `b`. With free room around them (owner 2026-11-16, two songs with a gap between them):
 * `a` lands exactly where it is held and `b` just steps aside, flush against it on the side `a` came from (`aCameFromLater` = a started after b). While `a` is still over b's old place b follows it
 * smoothly; once `a` has passed b's old place whole, nothing is displaced any more and b stays where it was. Returns null when that does not fit — another block is in the way of either of them,
 * or the edge of the day — and the two then trade places (`swapStarts`), as before.
 */
export function stepAside(
  aAt: number,
  aLen: number,
  b: { start: number; end: number },
  aCameFromLater: boolean,
  others: { start: number; end: number }[],
  bounds: { min: number; max: number },
): { a: number; b: number } | null {
  const bLen = b.end - b.start;
  const bAt = aCameFromLater ? aAt + aLen : aAt - bLen;
  if (aAt < bounds.min || aAt + aLen > bounds.max || bAt < bounds.min || bAt + bLen > bounds.max) return null;
  const hit = (start: number, len: number) => others.some((o) => start < o.end && start + len > o.start);
  return hit(aAt, aLen) || hit(bAt, bLen) ? null : { a: aAt, b: bAt };
}

// ── undo (owner 2026-11-15: "Ctrl/Cmd+Z undoes what I did on the schedule") ──
/** the fields of a schedule that a person changes on the studio and that the server stores */
const UNDO_FIELDS = ["name", "branchId", "targetType", "targetId", "sourceId", "deviceId", "recurrence", "oneOffDateLocal", "daysOfWeek", "startTimeLocal", "endTimeLocal", "enabled", "priority"] as const;

/** what must be PATCHed on `current` to make it `earlier` again — only the fields that differ ({} = identical) */
export function changedFields(current: Schedule, earlier: Schedule): Partial<Schedule> {
  const out: Record<string, unknown> = {};
  for (const k of UNDO_FIELDS) {
    const a = (current as Record<string, unknown>)[k];
    const b = (earlier as Record<string, unknown>)[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[k] = b ?? null;
  }
  return out as Partial<Schedule>;
}

/** the POST body that makes a deleted schedule again (same music, branch, days, hours, state) */
export function scheduleBody(s: Schedule): Record<string, unknown> {
  const tid = (s.targetId || s.sourceId || "").trim();
  const oneOff = s.recurrence === "one_off";
  return {
    name: s.name,
    branchId: s.branchId,
    targetType: s.targetType,
    targetId: tid,
    sourceId: s.targetType === "SOURCE" ? tid : undefined,
    deviceId: s.deviceId || undefined,
    recurrence: oneOff ? "one_off" : "weekly",
    ...(oneOff ? { oneOffDateLocal: s.oneOffDateLocal } : {}),
    daysOfWeek: oneOff ? [] : s.daysOfWeek,
    startTimeLocal: s.startTimeLocal,
    ...(s.endTimeLocal && s.endTimeLocal.trim() ? { endTimeLocal: s.endTimeLocal } : {}),
    enabled: s.enabled,
    priority: typeof s.priority === "number" ? s.priority : 1,
  };
}
