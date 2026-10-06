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
  if (args.direction === "next") {
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
