/**
 * P0 (2026-10-06) — LOCAL → URL session / transport coherence on the designated station (PURE, unit-testable).
 *
 * After a URL selection the renderer releases LOCAL ownership (the MAIN session is now the URL), but the provider
 * still holds the previous LOCAL source. Transport must then NEVER run on that stale provider state, and URL
 * playlist NEXT / PREV must step the SAME session playlist that MAIN mirrors (PLAY_SOURCE N±1 with trackIndex N±1)
 * instead of MAIN's catalog-step NEXT.
 */
import type { UnifiedSource } from "@/lib/source-types";
import { expandPlaylistEntityToItems, playlistLeafTrackIndexForQueueItem } from "@/lib/syncbiz-playlist-queue";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { isValidLocalFilePlaybackPath } from "@/lib/url-validation";

/**
 * Where a transport command runs:
 *  - "local": the in-renderer provider (MASTER-mode renderer, or designated station with an OWNED LOCAL session)
 *  - "remote": the MAIN (WS command / URL session step)
 */
export function routeStationTransport(args: {
  useLocalDeviceTransport: boolean;
  canLocalExec: boolean;
  currentSourceIsLocal: boolean;
  localSessionOwned: boolean;
}): "local" | "remote" {
  if (args.useLocalDeviceTransport) return "local";
  return args.canLocalExec && args.currentSourceIsLocal && args.localSessionOwned ? "local" : "remote";
}

const LEAF_MARKER = ":track:";

/** Parent playlist shell id of an expanded playlist leaf (`<shellId>:track:rN`), or null for a non-leaf. */
export function playlistShellIdOfLeaf(leaf: Pick<UnifiedSource, "id"> | null | undefined): string | null {
  const id = leaf?.id ?? "";
  const i = id.indexOf(LEAF_MARKER);
  return i > 0 ? id.slice(0, i) : null;
}

/**
 * Next / previous leaf of the URL playlist session the station is playing, or:
 *  - null  → no coherent URL playlist session can be resolved (caller falls back to the existing MAIN command)
 *  - { noop: true } → at the end with LOOP "off" (manual NEXT does not wrap — same rule as the provider)
 *
 * `sentLeaf` is the last URL leaf this renderer sent via PLAY_SOURCE (it carries the parent playlist with every
 * track URL) and is the step baseline. MAIN's mirrored session must still be the SAME playlist (`mainSourceId` is a
 * leaf of it) with the same track count, otherwise the session is not ours / not coherent → null. `mainTrackIndex`
 * is informational only (the mirror may lag one step behind a rapid NEXT).
 * Loop semantics (as PlaybackProvider): NEXT treats "track" as "playlist"; "off" never wraps past the end.
 * PREV always wraps from the first item to the last.
 */
export function resolveUrlSessionStep(args: {
  sentLeaf: UnifiedSource | null | undefined;
  mainSourceId: string | null | undefined;
  mainTrackIndex: number | null | undefined;
  mainSessionTrackCount: number | null | undefined;
  direction: "next" | "prev";
  repeatMode: "playlist" | "track" | "off";
  /** P0 Gate 2a: natural end with loop "track" replays the CURRENT item (LOCAL parity: computeSessionNextTrackIndex). */
  repeatCurrent?: boolean;
}): { leaf: UnifiedSource; trackIndex: number } | { noop: true } | null {
  const sent = args.sentLeaf;
  if (!sent?.playlist || sent.type === "local") return null;
  const shellId = playlistShellIdOfLeaf(sent);
  // MAIN must still be on the SAME playlist session we committed (any leaf of that playlist: its mirror may lag one
  // step behind a rapid NEXT). A different / non-playlist MAIN session (e.g. another controller took over) → null.
  if (!shellId || !args.mainSourceId || playlistShellIdOfLeaf({ id: args.mainSourceId }) !== shellId) return null;
  const leaves = expandPlaylistEntityToItems({ ...sent, id: shellId, origin: "playlist" });
  const count = leaves.length;
  if (count === 0) return null;
  if (typeof args.mainSessionTrackCount === "number" && args.mainSessionTrackCount > 0 && args.mainSessionTrackCount !== count) return null;
  // Step from OUR last committed index (authoritative for what we asked MAIN to play; immune to mirror lag).
  const cur = playlistLeafTrackIndexForQueueItem(sent);
  if (cur < 0 || cur >= count) return null;
  let target: number;
  if (args.direction === "next" && args.repeatCurrent && args.repeatMode === "track") {
    target = cur;
  } else if (args.direction === "next") {
    if (cur + 1 < count) target = cur + 1;
    else if (args.repeatMode === "off") return { noop: true };
    else target = 0;
  } else {
    target = cur > 0 ? cur - 1 : count - 1;
  }
  const leaf = leaves[target];
  if (!leaf || leaf.type === "local") return null;
  return { leaf, trackIndex: target };
}

/**
 * P0 Gate 1e (2026-10-08) — LOCKED INVARIANT: a NON-LOCAL PLAY_SOURCE must never change session / display metadata
 * unless it also carries a valid playable target for THAT EXACT track.
 */

/** The source's OWN playable remote URL (never a sibling track's URL, never a local path), or "". */
export function ownPlayableUrl(source: Pick<UnifiedSource, "url"> | null | undefined): string {
  const u = (source?.url ?? "").trim();
  if (!u || u.startsWith("local://") || isValidLocalFilePlaybackPath(u)) return "";
  return u;
}

/**
 * The exact non-LOCAL target for a (source, trackIndex) selection:
 *  - P0 Gate 2a: a REAL playlist leaf (it carries its OWN playable URL) IS the clicked track — its own row is the
 *    index; an omitted / defaulted 0 or any other index never redirects it to another row (Gate 1e regression:
 *    1-arg callers clicked track K and got track 0);
 *  - a playlist LEAF whose own row is trackIndex, or a non-playlist source → itself (unchanged);
 *  - a playlist shell with trackIndex > 0, or a leaf of ANOTHER row (e.g. a borrowed `:track:r0` id with trackIndex 24)
 *    → the parent playlist's leaf AT trackIndex (its own URL) — never the current leaf's URL / id as a substitute;
 *  - no playable URL for that exact track → reject (the caller sends nothing: fail closed).
 * A playlist shell with trackIndex 0 keeps the existing payload rule (its url, else the first playable track).
 */
export function resolveExactUrlTarget(
  source: UnifiedSource,
  trackIndex?: number,
): { source: UnifiedSource; trackIndex: number } | { reject: string } {
  const tracks = source.playlist ? getPlaylistTracks(source.playlist) : [];
  const shellId = playlistShellIdOfLeaf(source);
  const isLeaf = shellId !== null && tracks.length > 0;
  if (isLeaf && source.type !== "local" && ownPlayableUrl(source)) {
    return { source, trackIndex: playlistLeafTrackIndexForQueueItem(source) };
  }
  const idx = typeof trackIndex === "number" && Number.isInteger(trackIndex) && trackIndex >= 0
    ? trackIndex
    : isLeaf ? playlistLeafTrackIndexForQueueItem(source) : 0;
  let target = source;
  if (tracks.length > 0 && (isLeaf || idx > 0)) {
    if (!(isLeaf && playlistLeafTrackIndexForQueueItem(source) === idx)) {
      if (idx >= tracks.length) return { reject: `track ${idx} is not in the playlist` };
      // Check the exact track BEFORE expanding: a mirrored / partial track list without URLs (the incident shape)
      // has no playable target — and leaf expansion requires every track url to be a string.
      if (!ownPlayableUrl(tracks[idx])) return { reject: `track ${idx} has no playable URL` };
      if (!tracks.every((t) => typeof t.url === "string")) return { reject: "playlist track data incomplete (missing urls)" };
      const leaf = expandPlaylistEntityToItems({ ...source, id: shellId ?? source.id, origin: "playlist" })[idx];
      if (!leaf) return { reject: `track ${idx} is not in the playlist` };
      target = leaf;
    }
    if (target.type === "local") return { reject: `track ${idx} is LOCAL (not a URL target)` };
    if (!ownPlayableUrl(target)) return { reject: `track ${idx} has no playable URL` };
    return { source: target, trackIndex: idx };
  }
  // non-playlist / shell at index 0: the payload's url must be non-empty (checked by the caller via the payload)
  return { source: target, trackIndex: idx };
}

/**
 * P0 Gate 1e: absolute jump to item `targetIndex` of the URL playlist session this renderer committed — the twin of
 * `resolveUrlSessionStep` (same coherence rules). Returns the exact leaf (with its own URL) or null.
 */
export function resolveUrlSessionJump(args: {
  sentLeaf: UnifiedSource | null | undefined;
  mainSourceId: string | null | undefined;
  mainSessionTrackCount: number | null | undefined;
  targetIndex: number;
}): { leaf: UnifiedSource; trackIndex: number } | null {
  const sent = args.sentLeaf;
  if (!sent?.playlist || sent.type === "local") return null;
  const shellId = playlistShellIdOfLeaf(sent);
  if (!shellId || !args.mainSourceId || playlistShellIdOfLeaf({ id: args.mainSourceId }) !== shellId) return null;
  const leaves = expandPlaylistEntityToItems({ ...sent, id: shellId, origin: "playlist" });
  const count = leaves.length;
  if (count === 0) return null;
  if (typeof args.mainSessionTrackCount === "number" && args.mainSessionTrackCount > 0 && args.mainSessionTrackCount !== count) return null;
  if (!Number.isInteger(args.targetIndex) || args.targetIndex < 0 || args.targetIndex >= count) return null;
  const leaf = leaves[args.targetIndex];
  if (!leaf || leaf.type === "local" || !ownPlayableUrl(leaf)) return null;
  return { leaf, trackIndex: args.targetIndex };
}
