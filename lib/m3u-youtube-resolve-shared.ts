/**
 * Types + helpers shared by Library Add row and My Music M3U import follow-up / YouTube resolution.
 */

import type { UnifiedSource } from "@/lib/source-types";

export type M3uUnresolvedImportRow = {
  ref: string;
  reason: string;
  playlistOrder: number;
  displayTitle: string | null;
  durationSec: number | null;
  suggestedSearchQuery: string;
};

export type M3uYoutubeResolveContextState = {
  playlistId: string;
  playlistName: string;
  files: string[];
  trackDisplayNames: string[];
  resolvedSourceOrders: number[];
  unresolvedRows: M3uUnresolvedImportRow[];
};

/** OK payload from Electron `importLocalM3uPlaylist` (renderer-safe mirror). */
export type DesktopM3uImportOkShape = {
  playlistName: string;
  files: string[];
  resolvedSourceOrders?: number[];
  trackDisplayNames: string[];
  imported: number;
  unresolved: Array<{
    ref: string;
    reason: string;
    playlistOrder: number;
    displayTitle: string | null;
    durationSec: number | null;
    suggestedSearchQuery: string;
  }>;
  skipped: number;
};

export function deriveResolvedOrdersForMerge(files: string[], ipc?: number[]): number[] {
  if (ipc?.length === files.length) return ipc;
  return files.map((_, i) => i);
}

export function mapDesktopUnresolvedToRows(res: DesktopM3uImportOkShape): M3uUnresolvedImportRow[] {
  return res.unresolved.map((row) => ({
    ref: row.ref,
    reason: row.reason,
    playlistOrder: row.playlistOrder,
    displayTitle: row.displayTitle,
    durationSec: row.durationSec,
    suggestedSearchQuery: row.suggestedSearchQuery,
  }));
}

/** Build modal context after a playlist row exists (`unified.playlist.id`). */
export function buildM3uYoutubeResolveContext(
  unified: UnifiedSource,
  res: DesktopM3uImportOkShape,
): M3uYoutubeResolveContextState | null {
  if (unified.origin !== "playlist" || !unified.playlist || res.unresolved.length === 0) return null;
  const ro = deriveResolvedOrdersForMerge(res.files, res.resolvedSourceOrders);
  return {
    playlistId: unified.playlist.id,
    playlistName: unified.playlist.name,
    files: res.files.slice(),
    trackDisplayNames: res.trackDisplayNames.slice(),
    resolvedSourceOrders: ro,
    unresolvedRows: mapDesktopUnresolvedToRows(res),
  };
}

export function unresolvedM3uSummaryHint(
  entries: readonly { suggestedSearchQuery: string }[],
): string | undefined {
  if (entries.length === 0) return undefined;
  const first = entries[0]!.suggestedSearchQuery.trim();
  if (!first) return undefined;
  return entries.length === 1 ? first : `${first} (+${entries.length - 1} more)`;
}
