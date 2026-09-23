/**
 * SINGLE source of truth for the live playback position shown by every CONTROL surface
 * (phone / web / desktop). Both the elapsed-time text AND the progress bar must call this so
 * they never diverge, and every surface interpolates from the AUTHORITATIVE MASTER state the
 * same way.
 *
 *   livePosition = reported position + (now - positionAt), capped at duration, while playing.
 *   Paused/stopped/idle → frozen at the reported position.
 *   A pending local SEEK is shown immediately (optimistic) until the next MASTER snapshot.
 *
 * `positionAt` is the MASTER's capture timestamp (not the receiver's), so all clients agree.
 */
export function computeLivePosition(
  state:
    | { position?: number; positionAt?: number; duration?: number; status?: string }
    | null
    | undefined,
  pendingSeek?: number | null,
): number {
  if (pendingSeek != null && Number.isFinite(pendingSeek)) return pendingSeek;
  const pos = state?.position;
  if (typeof pos !== "number" || !Number.isFinite(pos)) return Number.NaN;
  const at = state?.positionAt;
  // Not playing, or no capture timestamp → the position is frozen at what the MASTER reported.
  if (state?.status !== "playing" || typeof at !== "number" || !Number.isFinite(at)) return pos;
  const dur =
    typeof state?.duration === "number" && Number.isFinite(state.duration) && state.duration > 0
      ? state.duration
      : Number.POSITIVE_INFINITY;
  return Math.min(pos + (Date.now() - at) / 1000, dur);
}
