/**
 * "OFF FOR THIS DAY" — one block switched off for one date only (the father 2026-11-18: "3 playlists a day — 8:00, 14:00, 18:00. I want to switch off only TODAY's 14:00 one, with an ON/OFF
 * button. Then the 8:00 playlist plays on without a break until the 18:00 one.").
 *
 * It is the one-day twin of the block's `enabled` switch ("Active", every day): a block that is off on a date is simply not part of that day's sequence — the engine does not start it, the
 * studio / phone board draw it as paused, and the block before it carries on until the next block that is on (exactly what a paused block does today).
 *
 * STORED with the block, shared by every window and the phone: in the block's existing `taxonomyTags` JSON column as `{ key: "skip-date", value: "YYYY-MM-DD" }` — NO database migration (the
 * column already exists, is nullable, and an older app simply ignores the tag). `Schedule.skipDates` is the clean view of it; other tags are never touched. Only dates that are today or later are
 * worth keeping, so the list never grows.
 * PURE (no I/O, no React) — shared by the server (store), the engine, the studio and the phone.
 */
import type { Schedule, TaxonomyTag } from "@/lib/types";

export const SKIP_TAG_KEY = "skip-date";
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** the most dates one block may hold (a year of single days is far more than anyone sets) */
export const SKIP_MAX = 400;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** the local date of `d` as YYYY-MM-DD */
export function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** is `v` a real calendar date written YYYY-MM-DD? */
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !YMD.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}

/** the skip dates held in a block's tags: valid, unique, in order */
export function skipDatesFromTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out = new Set<string>();
  for (const t of tags) {
    const tag = t as Partial<TaxonomyTag> | null;
    if (tag && tag.key === SKIP_TAG_KEY && isYmd(tag.value)) out.add(tag.value);
  }
  return [...out].sort();
}

/** is this block switched off on `ymd`? (no date given = not off) */
export function isSkippedOn(s: Pick<Schedule, "skipDates">, ymd: string | null | undefined): boolean {
  return !!ymd && Array.isArray(s.skipDates) && s.skipDates.includes(ymd);
}

/** the date list after switching `ymd` off / on — what the client sends. Dates before `todayYmd` are dropped (they can never matter again). */
export function withSkipDate(dates: readonly string[] | undefined, ymd: string, off: boolean, todayYmd: string): string[] {
  const set = new Set((dates ?? []).filter((d) => isYmd(d) && d >= todayYmd));
  if (off && isYmd(ymd)) set.add(ymd);
  else set.delete(ymd);
  return [...set].sort();
}

/** what the server accepts in a request: undefined = not sent; "invalid" = not a list of dates; otherwise the cleaned list */
export function normalizeSkipDates(raw: unknown): string[] | undefined | "invalid" {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw) || raw.length > SKIP_MAX) return "invalid";
  if (!raw.every((d) => isYmd(d))) return "invalid";
  return [...new Set(raw as string[])].sort();
}

/** the day `days` before `ymd` (a margin for the server's clock being a day or two off the branch's) */
function minusDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return ymdOf(new Date(y, m - 1, d - days));
}

/** the block's tags with the skip tags replaced by `dates` (past ones dropped, with a 2-day margin for time zones); every other tag is kept as it is (an empty list when nothing is left) */
export function tagsWithSkipDates(tags: unknown, dates: readonly string[], todayYmd: string): TaxonomyTag[] {
  const keepFrom = minusDays(todayYmd, 2);
  const others = Array.isArray(tags) ? (tags as TaxonomyTag[]).filter((t) => !(t && t.key === SKIP_TAG_KEY)) : [];
  const skip = [...new Set(dates)].filter((d) => isYmd(d) && d >= keepFrom).sort().map((value): TaxonomyTag => ({ key: SKIP_TAG_KEY, value }));
  return [...others, ...skip];
}
