/**
 * 2026-11-09 (CDP measurement on a live station: the player re-rendered ~17× a second). Desktop MAIN pushes a status
 * snapshot on EVERY MPV `time-pos` event, but the position it sends is whole seconds — so ~16 of every 17 pushes carry
 * exactly the values of the previous one. Each push used to re-render the whole ≈6,000-line player for nothing.
 *
 * Pure display-side helper: true when the two snapshots hold exactly the same values (same keys, `Object.is` per value).
 * The player still reads EVERY push into its refs (freeze clock, attempt confirmation, startup progress); only the React
 * state — what the screen draws — skips a push that would draw the same thing again.
 */
export function sameMpvSnap<T extends object>(prev: T | null, next: T): boolean {
  if (!prev) return false;
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = Object.keys(b);
  if (Object.keys(a).length !== keys.length) return false;
  for (const k of keys) if (!Object.is(a[k], b[k])) return false;
  return true;
}
