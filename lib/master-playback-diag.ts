/**
 * Dev-only diagnostics for branch MASTER playback (streamer / GOtv).
 */

export function masterPlaybackDiag(event: string, data?: Record<string, unknown>): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "development") return;
  if (typeof console === "undefined") return;
  console.info("[SyncBiz:master-playback]", event, data ?? {});
}
