import type { Playlist, PlaylistTrack, ScheduleContributorBlock } from "@/lib/playlist-types";
import { reconcilePlaylistTracksForMerge } from "@/lib/playlist-append-sources";

function newBlockId(): string {
  return `sch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Returns blocks that are a valid partition of `orderedTracks` (every track id exactly once, no unknown ids),
 * or `undefined` if stored blocks are missing ids, duplicate ids, or empty slices — treat as flat playlist for merge/UI.
 *
 * If persisted blocks omit some track ids that `orderedTracks` still contains (orphans), appends one direct block for
 * those ids so repeated playlist appends keep `hadBlocks` true and merge can append the next contributor block.
 */
export function coalesceScheduleContributorBlocksWithTracks(
  playlist: Playlist,
  orderedTracks: PlaylistTrack[],
): ScheduleContributorBlock[] | undefined {
  const blocks = playlist.scheduleContributorBlocks;
  if (!blocks?.length) return undefined;
  const tidSet = new Set(orderedTracks.map((t) => (t.id ?? "").trim()).filter(Boolean));
  const pruned = blocks
    .map((b) => ({
      ...b,
      trackIds: b.trackIds.filter((id) => tidSet.has(String(id).trim())),
    }))
    .filter((b) => b.trackIds.length > 0);
  const covered = new Set<string>();
  for (const b of pruned) {
    for (const id of b.trackIds) {
      const tid = String(id).trim();
      if (!tid || covered.has(tid)) return undefined;
      covered.add(tid);
    }
  }
  const missing = [...tidSet].filter((id) => !covered.has(id));
  if (missing.length === 0) {
    return pruned;
  }
  const orphanBlock: ScheduleContributorBlock = {
    id: newBlockId(),
    kind: "direct",
    label: "Existing tracks",
    trackIds: missing,
  };
  return [...pruned, orphanBlock];
}

export type ScheduleAppendContributorHint =
  | { type: "playlist"; label: string; sourceKey: string }
  | { type: "direct"; label: string };

/**
 * After appending new tracks, merge or create `scheduleContributorBlocks`.
 * - If playlist already has blocks: append one block for `newTrackIds`.
 * - If no blocks yet but there were prior tracks and a hint: legacy block + new block.
 * - If empty playlist before append: single new block when hint is set.
 * - If no hint and no existing blocks: returns undefined (flat playlist, unchanged).
 */
export function mergeScheduleContributorBlocksAfterAppend(
  playlist: Playlist,
  prevTrackIds: ReadonlySet<string>,
  newTrackIds: string[],
  hint: ScheduleAppendContributorHint | null,
): ScheduleContributorBlock[] | undefined {
  if (newTrackIds.length === 0) return playlist.scheduleContributorBlocks;

  const hadBlocks = !!(playlist.scheduleContributorBlocks && playlist.scheduleContributorBlocks.length > 0);
  const effectiveHint: ScheduleAppendContributorHint | null =
    hint ?? (hadBlocks ? { type: "direct", label: "Added items" } : null);

  if (!effectiveHint) {
    return playlist.scheduleContributorBlocks;
  }

  const newBlock: ScheduleContributorBlock =
    effectiveHint.type === "playlist"
      ? {
          id: newBlockId(),
          kind: "playlist",
          label: effectiveHint.label,
          sourcePlaylistKey: effectiveHint.sourceKey,
          trackIds: [...newTrackIds],
        }
      : {
          id: newBlockId(),
          kind: "direct",
          label: effectiveHint.label,
          trackIds: [...newTrackIds],
        };

  if (hadBlocks && playlist.scheduleContributorBlocks) {
    return [...playlist.scheduleContributorBlocks, newBlock];
  }

  const legacyIds = [...prevTrackIds].filter((id) => !newTrackIds.includes(id));
  if (legacyIds.length === 0) {
    return [newBlock];
  }

  const legacyBlock: ScheduleContributorBlock = {
    id: newBlockId(),
    kind: "direct",
    label: "Existing playlist",
    trackIds: legacyIds,
  };

  return [legacyBlock, newBlock];
}

/** Remove one track id from blocks; drop empty blocks. */
export function removeTrackFromScheduleContributorBlocks(
  blocks: ScheduleContributorBlock[] | undefined,
  removedTrackId: string,
): ScheduleContributorBlock[] | undefined {
  if (!blocks || blocks.length === 0) return blocks;
  const next = blocks
    .map((b) => ({
      ...b,
      trackIds: b.trackIds.filter((id) => id !== removedTrackId),
    }))
    .filter((b) => b.trackIds.length > 0);
  return next.length === 0 ? undefined : next;
}

/** Remove all tracks belonging to a contributor block from the merged track list. */
export function removeContributorBlockFromPlaylistData(
  playlist: Playlist,
  blockId: string,
): { tracks: PlaylistTrack[]; order: string[]; scheduleContributorBlocks: ScheduleContributorBlock[] | undefined } | null {
  const blocks = playlist.scheduleContributorBlocks;
  if (!blocks?.length) return null;
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return null;

  const removeSet = new Set(block.trackIds);
  const ordered = reconcilePlaylistTracksForMerge(playlist);
  const nextOrdered = ordered.filter((t) => !removeSet.has(t.id));
  if (nextOrdered.length === 0) {
    throw new Error("Cannot remove last track via contributor block; use playlist delete.");
  }

  const nextBlocks = blocks.filter((b) => b.id !== blockId);
  const order = nextOrdered.map((t) => t.id);
  return {
    tracks: nextOrdered,
    order,
    scheduleContributorBlocks: nextBlocks.length === 0 ? undefined : nextBlocks,
  };
}
