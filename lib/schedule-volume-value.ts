/**
 * A schedule block's VOLUME as a value — pure, no React (the API routes use it, so it must stay out of the client-side store in lib/schedule-volume.ts).
 */

/** what a request / form carries → a whole number 0–100, `null` (clear it), `undefined` (not mentioned) or `"invalid"` */
export function normalizeScheduleVolume(raw: unknown): number | null | undefined | "invalid" {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) return "invalid";
  return Math.round(n);
}
