/**
 * A REMOTE STARTS A LOCAL (COMPUTER-FILES) PLAYLIST ON THE STATION - IDS ONLY (owner 2026-11-26: "also fine if it needs an installer").
 *
 * WHY A SEPARATE COMMAND. A LOCAL song can only be started by the station's OWN window (the renderer drives the existing LOCAL engine ->
 * mpvPlayUrl -> MAIN). MAIN's `PLAY_SOURCE` with `type: "local"` is METADATA ONLY (it sets the title / queue and plays nothing: the audio is
 * "handled by the co-located renderer"), so sending it from a Remote made the screen say a playlist was playing while the music did not change.
 * The Remote therefore refused it (fail closed) and a local playlist could not be started from a Remote at all.
 *
 * THE COMMAND. `PLAY_LOCAL_SOURCE { sourceId, trackIndex }` - two plain values and NOTHING else: never a path, never a url, never a title, never
 * a track list (CLAUDE.md section 12: local filesystem paths are LOCAL ONLY). Route: Remote -> WS server (shape guard, same rule) -> station MAIN
 * (shape guard again, then ONE exactly-once relay request on the status snapshot, the same channel as the remote NEXT / PREV / JUMP relay) ->
 * the station's own window, which looks the playlist up BY ID in its own library and starts it exactly like a click on that playlist.
 * Any doubt at any step = change nothing and keep the current music.
 *
 * This file is PURE (no React, no window): the three shape guards (this one, `server/local-play-command.ts`, `desktop/src/shared/local-play-command.ts`)
 * are kept identical by `scripts/verify-remote-local-play.ts`.
 */

import type { UnifiedSource } from "@/lib/source-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { isLibraryLocalSource } from "@/lib/library-display-classification";
import { playlistShellIdOfLeaf } from "@/lib/station-transport-routing";
import { playlistLeafTrackIndexForQueueItem } from "@/lib/syncbiz-playlist-queue";

/** the command name on the wire */
export const LOCAL_PLAY_COMMAND = "PLAY_LOCAL_SOURCE" as const;

/** the ONLY shape that crosses the wire */
export type LocalPlayRequest = { sourceId: string; trackIndex: number };

/** ids are plain: letters, digits, `_ : . -` (a path, a url, a `local://` ref or a `file:` uri can never match: no `/`, no `\`, no spaces) */
const SAFE_ID = /^[A-Za-z0-9_:.-]{1,200}$/;
const MAX_TRACK_INDEX = 100_000;

export function isSafeLocalPlayId(v: unknown): v is string {
  return typeof v === "string" && SAFE_ID.test(v) && !v.startsWith("local:") && !v.startsWith("file:");
}

/** a non-negative whole number the size of a playlist */
export function isSafeLocalPlayIndex(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_TRACK_INDEX;
}

/** PURE: is this exactly `{ sourceId, trackIndex }` and nothing more (an extra field, e.g. a smuggled url or path, makes it invalid) */
export function isLocalPlayPayload(p: unknown): p is LocalPlayRequest {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const keys = Object.keys(p as Record<string, unknown>);
  if (keys.length !== 2 || !keys.includes("sourceId") || !keys.includes("trackIndex")) return false;
  const o = p as { sourceId?: unknown; trackIndex?: unknown };
  return isSafeLocalPlayId(o.sourceId) && isSafeLocalPlayIndex(o.trackIndex);
}

/**
 * PURE, Remote side: the request a click on a LOCAL source becomes, or a reject (the caller then sends nothing: fail closed).
 * A leaf of a playlist (`<shell>:track:rN`) is the shell + its row; a playlist shell is itself; the row is the one the click named.
 */
export function resolveLocalPlayRequest(source: UnifiedSource | null | undefined, trackIndex?: number): LocalPlayRequest | { reject: string } {
  if (!source) return { reject: "no source" };
  if (!isLibraryLocalSource(source)) return { reject: "not a local source" };
  const shell = playlistShellIdOfLeaf(source);
  const sourceId = shell ?? source.id;
  if (!isSafeLocalPlayId(sourceId)) return { reject: "the source id is not a plain id" };
  const wanted = isSafeLocalPlayIndex(trackIndex) ? trackIndex : shell ? playlistLeafTrackIndexForQueueItem(source) : 0;
  if (!isSafeLocalPlayIndex(wanted)) return { reject: "the track number is not valid" };
  if (source.playlist) {
    const count = getPlaylistTracks(source.playlist).length;
    if (count > 0 && wanted >= count) return { reject: `track ${wanted} is not in the playlist` };
  }
  return { sourceId, trackIndex: wanted };
}

/** a double click (or a second tap) on the SAME playlist row within this window is one intent, not two (the URL path has the same rule) */
export const LOCAL_PLAY_DUPLICATE_MS = 1500;

/** PURE: true when `req` is the same target as the request sent `last.at` ms ago, still inside the duplicate window */
export function isDuplicateLocalPlay(last: { key: string; at: number } | null | undefined, req: LocalPlayRequest, now: number): boolean {
  return !!last && last.key === `${req.sourceId}#${req.trackIndex}` && now - last.at >= 0 && now - last.at < LOCAL_PLAY_DUPLICATE_MS;
}

export function localPlayKey(req: LocalPlayRequest): string {
  return `${req.sourceId}#${req.trackIndex}`;
}

/**
 * PURE, station side: the library entry the relayed request names, or a reject (the station then changes nothing).
 * The lookup is by ID in the station's OWN library; a source that is not a LOCAL one here, or a row that is not in it, is refused.
 */
export function resolveRelayedLocalTarget(
  items: readonly UnifiedSource[] | null | undefined,
  req: { sourceId: unknown; trackIndex: unknown },
): { source: UnifiedSource; trackIndex: number } | { reject: string } {
  if (!isSafeLocalPlayId(req.sourceId) || !isSafeLocalPlayIndex(req.trackIndex)) return { reject: "invalid request" };
  const found = (items ?? []).find((s) => s.id === req.sourceId);
  if (!found) return { reject: "not in this station's library" };
  if (!isLibraryLocalSource(found)) return { reject: "not a local source on this station" };
  if (found.playlist) {
    const count = getPlaylistTracks(found.playlist).length;
    if (count > 0 && req.trackIndex >= count) return { reject: `track ${req.trackIndex} is not in the playlist` };
  }
  return { source: found, trackIndex: req.trackIndex };
}
