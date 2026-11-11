/**
 * 2026-11-11 (owner): "we never cut a business's music in the middle of the day". A private bank that is switched off (or,
 * later, locked for non-payment) keeps playing until the NEXT 04:00 in the branch's own time, then the station switches to
 * its fallback music at a song boundary. PURE (no I/O) — safe on the server and in the browser.
 */

/** The hour a close takes effect, in the branch's local time. */
export const CLOSE_HOUR_LOCAL = 4;
/**
 * After closesAt the media token still carries the bank for this long, so the station finishes the song it is playing and
 * its renderer guard has time to switch to the fallback — the bank is never cut into silence (MAIN gives up after a few
 * refused tracks). The catalog stops listing the bank exactly at closesAt.
 */
export const CLOSE_GRACE_MS = 30 * 60 * 1000;

function validTimeZone(tz: string | null | undefined): string {
  const z = (tz ?? "").trim();
  if (!z) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return "UTC";
  }
}

/** Wall-clock parts of `at` in `tz`. */
function wallParts(at: Date, tz: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: n("year"), m: n("month"), d: n("day"), h: n("hour") % 24, min: n("minute"), s: n("second") };
}

/** Offset of `tz` from UTC at instant `at`, in ms (local wall time − UTC). */
function offsetMs(at: Date, tz: string): number {
  const p = wallParts(at, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant whose wall-clock time in `tz` is y-m-d hh:00 (DST-safe: two passes). */
function zonedInstant(y: number, m: number, d: number, hh: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, 0, 0);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

/** The first 04:00 (branch time) strictly after `at`. Unknown / empty time zone → UTC. */
export function nextLocalFour(at: Date, timeZone: string | null | undefined): Date {
  const tz = validTimeZone(timeZone);
  const p = wallParts(at, tz);
  const today = zonedInstant(p.y, p.m, p.d, CLOSE_HOUR_LOCAL, tz);
  if (today.getTime() > at.getTime()) return today;
  const tomorrow = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return zonedInstant(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), CLOSE_HOUR_LOCAL, tz);
}

/**
 * When a close requested at `at` takes effect for a business whose branches use `timeZones`: the LATEST of their next
 * 04:00s, so no branch is cut before its own 04:00. No branches → UTC.
 */
export function closeTakesEffectAt(at: Date, timeZones: Array<string | null | undefined>): Date {
  const zones = timeZones.length > 0 ? timeZones : ["UTC"];
  return zones.map((z) => nextLocalFour(at, z)).reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
}

/** The last day an "until" date covers: it plays through that whole day and stops at 04:00 the morning after (branch time). */
export function untilDateTakesEffectAt(day: string, timeZones: Array<string | null | undefined>): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  // per branch: noon of that day in ITS time → the next 04:00 after it is the morning after; the latest branch wins
  const zones = timeZones.length > 0 ? timeZones : ["UTC"];
  return zones
    .map((z) => {
      const tz = validTimeZone(z);
      return nextLocalFour(zonedInstant(Number(m[1]), Number(m[2]), Number(m[3]), 12, tz), tz);
    })
    .reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
}

/** A grant's moment of ending: the earlier of its close and its end date (null = open, no end). */
export function grantEndsAt(g: { closesAt: Date | null; expiresAt: Date | null }): Date | null {
  const a = g.closesAt?.getTime() ?? Infinity;
  const b = g.expiresAt?.getTime() ?? Infinity;
  const t = Math.min(a, b);
  return Number.isFinite(t) ? new Date(t) : null;
}
