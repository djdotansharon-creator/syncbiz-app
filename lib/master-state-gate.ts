/**
 * Which MASTER STATE_UPDATE messages reach the screen (owner 2026-11-09: "the whole library redraws every second — only what changed should").
 *
 * MAIN publishes on every MPV event (several a second) with the position in WHOLE seconds plus `positionAt` (MAIN's capture time). Every surface
 * that shows the position EXTRAPOLATES it (`computeLivePosition`: position + (now − positionAt)) on its own clock, so while a song simply plays on,
 * a new second carries no new information — yet each one became a new `masterState` and redrew ~36 consumers (player, queue, the whole library).
 *
 * Rule (a pure function so it can be tested without React):
 *   • Anything other than the clock changed (track, status, volume, queue, modes, duration, attempt …) → applied at once.
 *   • Not playing, or a song transition is in progress, or no usable clock → the previous rule, unchanged (c3d3208, 2026-11-05):
 *     identical apart from `positionAt` → dropped, but re-applied every 1.5 s.
 *   • Playing: the message is dropped while its position agrees with the extrapolation from the last applied one (± 1.5 s). It is applied when
 *       – it disagrees by more than 1.5 s: a SEEK, a STALL (a frozen position shows within ≤ 2.5 s and keeps re-showing every 1.5 s, as before),
 *         a restart;
 *       – MAIN's clock went backwards;
 *       – or 5 s have passed and this is the FIRST message of a new second (a fresh, exact base — the bar never drifts).
 * Display-only: nothing here sends a command or touches playback.
 */

export const MASTER_CLOCK_TOLERANCE_S = 1.5;
export const MASTER_SAME_STATE_REAPPLY_MS = 1500;
export const MASTER_REANCHOR_MS = 5000;

export type MasterGateInput = { position?: number; positionAt?: number; status?: string } & Record<string, unknown>;

export type MasterGateMemo = {
  /** the last APPLIED message without positionAt (the 2026-11-05 key) */
  fullKey: string;
  /** the last APPLIED message without positionAt AND position */
  clockFreeKey: string;
  /** the last APPLIED message's positionAt / position */
  at: number;
  pos: number;
  /** the position of the last RECEIVED message (applied or not) — tells the first message of a new second */
  seenPos: number;
};

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return ""; // unserialisable → always applied
  }
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function gateMasterState(
  last: MasterGateMemo | null,
  state: MasterGateInput,
  inTransition: boolean,
): { apply: boolean; memo: MasterGateMemo } {
  const { positionAt, ...withPosition } = state;
  const { position, ...clockFree } = withPosition;
  const fullKey = stringify(withPosition);
  const clockFreeKey = stringify(clockFree);
  const at = finite(positionAt) ? positionAt : 0;
  const pos = finite(position) ? position : Number.NaN;

  const applied: MasterGateMemo = { fullKey, clockFreeKey, at, pos, seenPos: pos };
  if (!last || fullKey === "" || clockFreeKey === "") return { apply: true, memo: applied };
  const dropped: MasterGateMemo = { ...last, seenPos: pos };

  // something besides the clock changed → at once
  if (clockFreeKey !== last.clockFreeKey) return { apply: true, memo: applied };

  const clockUsable = finite(pos) && finite(last.pos) && at > 0 && last.at > 0;
  if (state.status !== "playing" || inTransition || !clockUsable) {
    // the 2026-11-05 rule, unchanged
    if (fullKey === last.fullKey && at - last.at < MASTER_SAME_STATE_REAPPLY_MS) return { apply: false, memo: dropped };
    return { apply: true, memo: applied };
  }

  if (at < last.at) return { apply: true, memo: applied }; // MAIN's clock went backwards → take the new base
  const expected = last.pos + (at - last.at) / 1000;
  if (Math.abs(pos - expected) > MASTER_CLOCK_TOLERANCE_S) return { apply: true, memo: applied };
  const firstOfNewSecond = !Object.is(pos, last.seenPos);
  if (firstOfNewSecond && at - last.at >= MASTER_REANCHOR_MS) return { apply: true, memo: applied };
  return { apply: false, memo: dropped };
}
