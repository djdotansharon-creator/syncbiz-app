/**
 * THE PHONE'S SCHEDULE — the pure rules (owner 2026-11-20: "I must get the song scheduling working on the phone, properly, nicely designed").
 * The phone now makes the plan itself: add a block, change its music / time / days, remove it from one day or from all of them — with the SAME routes the computer's
 * Schedules Studio uses (POST /api/schedules, PATCH / DELETE /api/schedules/:id), so the station obeys it at its next look (within 30 s) and the computer shows the same plan.
 * No React and no I/O here, so a test can run every rule. The drawing is components/vm/vm-schedule.tsx.
 */
import type { Schedule } from "@/lib/types";
import type { UnifiedSource } from "@/lib/source-types";
import { explicitEndMinutes } from "@/lib/schedule-actions";
import { DAY_MINUTES, appliesOnDay, daysKind, minutesToTimeLocal, paletteIndex, startMinutes, weekDatesFor, type Scene } from "@/lib/schedules-timeline";
import { isYmd } from "@/lib/schedule-skip";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import type { Hs } from "@/lib/cover-tone";

/** what a block plays: a playlist, a single song, a radio station — or nothing (a quiet block) */
export type MusicChoice = {
  targetType: "PLAYLIST" | "SOURCE" | "RADIO" | "SILENCE" | "BANK";
  targetId: string;
  title: string;
  cover: string | null;
};

/** the quiet block: it stops the music at its start (the same block the computer's "Quiet — no music" makes) */
export const QUIET_CHOICE: MusicChoice = { targetType: "SILENCE", targetId: "silence", title: "", cover: null };

/** a library entry as a block's music (null for a row that cannot be scheduled) */
export function musicOfSource(u: UnifiedSource): MusicChoice | null {
  if (u.id.includes(":track:")) return null; // one song INSIDE a playlist is not a block's music — its playlist is
  if (u.origin === "playlist") return { targetType: "PLAYLIST", targetId: u.playlist?.id ?? u.id, title: u.title, cover: u.cover ?? null };
  if (u.origin === "source") return { targetType: "SOURCE", targetId: u.source?.id ?? u.id, title: u.title, cover: u.cover ?? null };
  if (u.origin === "radio") return { targetType: "RADIO", targetId: u.id, title: u.title, cover: u.cover ?? null };
  return null;
}

/**
 * Can this library entry be scheduled on `branchId`? The server refuses music that belongs to ANOTHER branch ("belongs to a different branch"), so the picker does not offer it.
 * An entry with no branch of its own (legacy) is the "default" branch's and is kept — the server decides about that alias (it is the same branch as the workspace's own).
 */
export function fitsBranch(u: UnifiedSource, branchId: string, knownBranchIds: ReadonlySet<string>): boolean {
  const own = resolveMediaBranchId(u.playlist ?? u.source ?? u.radio ?? {});
  return own === branchId || !knownBranchIds.has(own);
}

/** the music a stored block plays: found in the library when it can be, else what the block itself remembers (its name) */
export function musicOfSchedule(s: Schedule, lookup: (s: Schedule) => UnifiedSource | undefined): MusicChoice {
  if (s.targetType === "SILENCE") return { ...QUIET_CHOICE, title: s.name?.trim() ?? "" };
  const u = lookup(s);
  const m = u ? musicOfSource(u) : null;
  if (m) return m;
  return { targetType: s.targetType as MusicChoice["targetType"], targetId: (s.targetId || s.sourceId || "").trim(), title: s.name?.trim() ?? "", cover: null };
}

// ───────────── the block's form ─────────────

export type BlockForm = {
  music: MusicChoice | null;
  /** minutes after midnight */
  start: number;
  /** "next" = plays until the next block starts (nothing is stored but the default 23:59) · "at" = stops at `end` */
  endMode: "next" | "at";
  end: number;
  /** every week on `days` · only on `onceDate` */
  repeat: "weekly" | "once";
  /** 0 = Sunday … 6 = Saturday, sorted, no repeats */
  days: number[];
  /** YYYY-MM-DD, used when repeat = "once" */
  onceDate: string;
};

export const EVERY_DAY: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
/** Monday–Friday: the computer's own "Weekdays" (lib/schedules-timeline.ts `daysKind`) */
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

const cleanDays = (days: readonly number[]): number[] => [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);

/** a start that is a sensible next step: today → the next quarter of an hour; another day → where the last block ends (or 09:00) */
export function suggestStart(opts: { isToday: boolean; nowMin: number; scenes: readonly Scene[] }): number {
  if (opts.isToday) {
    const next = Math.ceil((opts.nowMin + 5) / 15) * 15;
    return Math.min(DAY_MINUTES - 15, next);
  }
  const live = opts.scenes.filter((s) => !s.paused && !s.shadowed);
  const last = live.length ? Math.max(...live.map((s) => s.end)) : 0;
  return live.length && last > 0 && last < DAY_MINUTES - 60 ? Math.ceil(last / 15) * 15 : 9 * 60;
}

/** a new block opened on `dateYmd` (whose weekday is `dow`) */
export function newForm(opts: { dateYmd: string; dow: number; start: number }): BlockForm {
  return { music: null, start: opts.start, endMode: "next", end: Math.min(DAY_MINUTES - 1, opts.start + 60), repeat: "weekly", days: [opts.dow], onceDate: opts.dateYmd };
}

/** an existing block as a form (to change it) */
export function formFromSchedule(s: Schedule, music: MusicChoice, fallbackDateYmd: string): BlockForm {
  const start = startMinutes(s);
  const own = explicitEndMinutes(s);
  const once = s.recurrence === "one_off";
  return {
    music,
    start,
    endMode: own !== null ? "at" : "next",
    end: own ?? Math.min(DAY_MINUTES - 1, start + 60),
    repeat: once ? "once" : "weekly",
    days: cleanDays(Array.isArray(s.daysOfWeek) ? s.daysOfWeek : []),
    onceDate: isYmd(s.oneOffDateLocal) ? s.oneOffDateLocal : fallbackDateYmd,
  };
}

export type FormProblem = "music" | "end" | "days" | "date" | "clash";

/** what is still missing before the block can be saved (null = nothing) — the first thing a person must fix */
export function formProblem(f: BlockForm): FormProblem | null {
  if (!f.music) return "music";
  if (f.repeat === "weekly" && cleanDays(f.days).length === 0) return "days";
  if (f.repeat === "once" && !isYmd(f.onceDate)) return "date";
  if (f.endMode === "at" && !(f.end > f.start && f.end <= DAY_MINUTES - 1)) return "end";
  return null;
}

/**
 * Two blocks that start on the same minute of the same day cannot both play: the engine keeps one and drops the other, and WHICH one is decided by the blocks' ids (a coin toss to a person).
 * So the phone never makes that clash: it says so before saving. Returns the block already on that minute (on one of the days the form covers), or null.
 * `weekDates` = the dates of the week on screen (a one-time block elsewhere in the year cannot clash with a block of this week).
 */
export function clashingBlock(f: BlockForm, schedules: readonly Schedule[], ignoreId: string | null, weekDates: readonly string[]): Schedule | null {
  const dayDates: { dow: number; dates: string[] }[] =
    f.repeat === "once" && isYmd(f.onceDate)
      ? (() => {
          const [y, m, d] = f.onceDate.split("-").map(Number) as [number, number, number];
          const dates = weekDatesFor(new Date(y, m - 1, d, 12));
          return [{ dow: dates.indexOf(f.onceDate), dates }];
        })()
      : cleanDays(f.days).map((dow) => ({ dow, dates: weekDates as string[] }));
  for (const s of schedules) {
    if (s.id === ignoreId || !s.enabled || startMinutes(s) !== f.start) continue;
    if (dayDates.some(({ dow, dates }) => dow >= 0 && appliesOnDay(s, dow, dates))) return s;
  }
  return null;
}

/** the fields a block is saved with — the same ones the computer saves (a POST makes the block, a PATCH changes it) */
export function blockFields(f: BlockForm, quietName: string): Record<string, unknown> {
  const m = f.music!;
  const once = f.repeat === "once";
  return {
    name: m.targetType === "SILENCE" ? quietName : m.title,
    targetType: m.targetType,
    targetId: m.targetId,
    ...(m.targetType === "SOURCE" ? { sourceId: m.targetId } : {}),
    recurrence: once ? "one_off" : "weekly",
    daysOfWeek: once ? [] : cleanDays(f.days),
    ...(once ? { oneOffDateLocal: f.onceDate } : {}),
    startTimeLocal: minutesToTimeLocal(f.start),
    // "until the next block" is the stored default 23:59 (explicitEndMinutes reads it as "no end of its own")
    endTimeLocal: f.endMode === "at" ? minutesToTimeLocal(f.end) : "23:59:00",
  };
}

export function createBody(f: BlockForm, branchId: string, quietName: string): Record<string, unknown> {
  return { ...blockFields(f, quietName), branchId, enabled: true, priority: 1 };
}

/** the days a weekly block keeps after one weekday is taken off it (the Studio's own "this day only" rule) */
export function daysWithout(s: Pick<Schedule, "daysOfWeek">, dow: number): number[] {
  return cleanDays((Array.isArray(s.daysOfWeek) ? s.daysOfWeek : []).filter((d) => d !== dow));
}

/** can ONE day be taken off this block (it is weekly and plays on more than that day)? Otherwise removing it removes the block. */
export function canRemoveOneDay(s: Pick<Schedule, "recurrence" | "daysOfWeek">, dow: number): boolean {
  return s.recurrence !== "one_off" && daysWithout(s, dow).length > 0 && daysWithout(s, dow).length < cleanDays(s.daysOfWeek ?? []).length;
}

// ───────────── what is said about days ─────────────

export type DaysText = { kind: "every" | "weekdays" | "weekend" | "custom" | "once"; days: number[]; date?: string };

/** how often a block happens, as a small structure the screen turns into words */
export function daysTextOf(s: Pick<Schedule, "recurrence" | "daysOfWeek" | "oneOffDateLocal">): DaysText {
  if (s.recurrence === "one_off") return { kind: "once", days: [], date: s.oneOffDateLocal };
  const days = cleanDays(Array.isArray(s.daysOfWeek) ? s.daysOfWeek : []);
  const kind = daysKind(days);
  // the stored week is Sunday-first; "weekdays" in daysKind is Monday–Friday and "weekend" Saturday+Sunday — kept as the computer names them
  return { kind, days };
}

// ───────────── the week strip ─────────────

export type StripDay = { ymd: string; dow: number; day: number; isToday: boolean; isSelected: boolean; hasBlocks: boolean };

/** the seven days (Sunday first) of the week of `weekDates` (what `weekDatesFor` gives) — which one is today, which one is open, which have a plan */
export function stripDays(weekDates: readonly string[], todayYmd: string, selectedYmd: string, schedules: readonly Schedule[] | null): StripDay[] {
  return weekDates.map((ymd, dow) => ({
    ymd,
    dow,
    day: Number(ymd.slice(8, 10)),
    isToday: ymd === todayYmd,
    isSelected: ymd === selectedYmd,
    hasBlocks: !!schedules && schedules.some((s) => s.enabled && appliesOnDay(s, dow, weekDates as string[])),
  }));
}

// ───────────── the day, as one bar ─────────────

export type BarSegment = { left: number; width: number; quiet: boolean };

/** the day's blocks as parts of one 24-hour bar (percent of the day); a block that is off or shadowed is not drawn */
export function barSegments(scenes: readonly Scene[]): BarSegment[] {
  return scenes
    .filter((s) => !s.paused && !s.shadowed && s.end > s.start)
    .map((s) => ({ left: (s.start / DAY_MINUTES) * 100, width: Math.max(0.6, ((s.end - s.start) / DAY_MINUTES) * 100), quiet: s.quiet }));
}

/** where a row stands against the clock: it plays now · it is the next one · it is over · it is still to come · it is switched off for the day */
export type RowState = "now" | "next" | "past" | "later" | "off";
export function rowState(sc: Scene, ctx: { isToday: boolean; nowMin: number; playing: Scene | null; next: Scene | null }): RowState {
  if (sc.offDay) return "off";
  if (!ctx.isToday) return "later";
  if (ctx.playing === sc) return "now";
  if (ctx.next === sc) return "next";
  return sc.end <= ctx.nowMin ? "past" : "later";
}

// ───────────── block colour ─────────────

/** the accent and the soft wash of a block: the colour of its picture when that is known (a grey picture → a calm grey), else the blue family the Studio starts from (a playlist is always the same blue) */
export function blockColours(hs: Hs | null, key: string): { accent: string; wash: string } {
  if (hs) {
    const grey = hs.s < 0.12;
    const s = grey ? 0.08 : Math.min(0.75, Math.max(0.4, hs.s));
    const h = Math.round(hs.h);
    return { accent: `hsl(${h} ${Math.round(s * 100)}% ${grey ? 62 : 60}%)`, wash: `hsl(${h} ${Math.round(s * 70)}% 30% / 0.55)` };
  }
  const h = [212, 218, 224, 205, 230, 198, 236, 192][paletteIndex(key)] ?? 214;
  return { accent: `hsl(${h} 70% 62%)`, wash: `hsl(${h} 50% 30% / 0.5)` };
}
