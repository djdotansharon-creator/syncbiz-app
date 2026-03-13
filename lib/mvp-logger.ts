/**
 * MVP logger – logs events to console with [SyncBiz MVP] prefix.
 */

export type MvpLogEvent =
  | "playlist_selected"
  | "playback_started"
  | "playback_paused"
  | "track_changed"
  | "playback_error"
  | "playlist_load_failed"
  | "invalid_url"
  | "empty_playlist";

export function log(event: MvpLogEvent, data?: Record<string, unknown>): void {
  const payload = data ? { event, ...data } : { event };
  console.log("[SyncBiz MVP]", JSON.stringify(payload));
}
