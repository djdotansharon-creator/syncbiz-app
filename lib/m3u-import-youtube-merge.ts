/**
 * Stage 5C-C — reorder M3U import locals + chosen YouTube rows by unified `playlistOrder`
 * before PUT /api/playlists/:id. No search here.
 */

import type { PlaylistTrack } from "@/lib/playlist-types";
import {
  canonicalYouTubeWatchUrlForPlayback,
  getYouTubeThumbnail,
  getYouTubeVideoId,
} from "@/lib/playlist-utils";

export type M3uYoutubePickForMerge = {
  /** Resolved watch/embed URL acceptable to persist rules. */
  url: string;
  title: string;
  cover?: string | null;
  durationSeconds?: number;
  viewCount?: number;
};

/**
 * @param picksByPlaylistOrder — user-chosen replacements for unresolved playlist rows (sparse).
 * Rows without picks are omitted (still unresolved vs source file).
 */
export function mergeM3uLocalsWithYoutubePicks(opts: {
  existingLocalTracksInOrder: PlaylistTrack[];
  files: string[];
  resolvedSourceOrders: number[];
  picksByPlaylistOrder: ReadonlyMap<number, M3uYoutubePickForMerge>;
}): { tracks: PlaylistTrack[] } {
  const { existingLocalTracksInOrder, files, resolvedSourceOrders, picksByPlaylistOrder } = opts;
  if (files.length !== resolvedSourceOrders.length) {
    throw new Error("M3U merge: files and resolvedSourceOrders length mismatch.");
  }
  if (existingLocalTracksInOrder.length !== files.length) {
    throw new Error("M3U merge: persisted local track count mismatch.");
  }

  const localByPlaylistOrder = new Map<number, PlaylistTrack>();
  for (let i = 0; i < files.length; i++) {
    const order = resolvedSourceOrders[i]!;
    localByPlaylistOrder.set(order, existingLocalTracksInOrder[i]!);
  }

  const orders = new Set<number>();
  localByPlaylistOrder.forEach((_, k) => orders.add(k));
  picksByPlaylistOrder.forEach((_, k) => orders.add(k));
  const sorted = [...orders].sort((a, b) => a - b);

  const tracks: PlaylistTrack[] = [];
  for (const ord of sorted) {
    const pick = picksByPlaylistOrder.get(ord);
    if (pick) {
      const url = canonicalYouTubeWatchUrlForPlayback(pick.url).trim();
      if (!getYouTubeVideoId(url)) {
        throw new Error("M3U merge: picked row is not a single YouTube video URL.");
      }
      const thumb = (pick.cover && pick.cover.trim()) || getYouTubeThumbnail(url);
      tracks.push({
        id: crypto.randomUUID(),
        name: pick.title.trim(),
        type: "youtube",
        url,
        cover: thumb || undefined,
        durationSeconds: pick.durationSeconds,
        viewCount: pick.viewCount,
      });
      continue;
    }

    const local = localByPlaylistOrder.get(ord);
    if (!local || local.type !== "local") {
      continue;
    }
    tracks.push({
      ...local,
      id: local.id.trim(),
      name: (local.name ?? "").trim() || local.id.trim(),
      url: local.url.trim(),
      type: "local",
    });
  }

  if (tracks.length === 0) {
    throw new Error("M3U merge: empty track list.");
  }

  return { tracks };
}
