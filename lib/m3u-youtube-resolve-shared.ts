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

/**
 * Save mode for the resolver modal.
 * - `merge_with_locals` (default): existing M3U import flow — playlist already exists with
 *   N local rows; Apply does GET → merge YouTube picks alongside locals → PUT.
 * - `create_youtube_only`: Spotify playlist/album import (legacy) and paste-tracklist flow —
 *   no playlist exists yet, no locals. Apply builds a YouTube-only tracks array from picks
 *   and POSTs a new playlist.
 * - `append_to_existing_youtube`: Stage 6D-Auto fallback. The Spotify auto-build flow
 *   already created a YouTube playlist for the resolved rows; this mode opens the modal
 *   for the *missing* rows so the operator can manually pick matches and APPEND them to
 *   that just-created playlist (GET → push picks at end → PUT). No order preservation
 *   beyond append — the resolved rows already preserved Spotify order at create time.
 */
export type M3uYoutubeResolveSaveMode =
  | "merge_with_locals"
  | "create_youtube_only"
  | "append_to_existing_youtube";

export type M3uYoutubeResolveContextState = {
  /** Empty string in `create_youtube_only` mode — playlist is created on Apply. */
  playlistId: string;
  playlistName: string;
  files: string[];
  trackDisplayNames: string[];
  /**
   * Dual-purpose, semantic depends on `mode`:
   * - `merge_with_locals`: index into `files` for each persisted local track position
   *   (length = files.length).
   * - `append_to_existing_youtube`: `playlistOrder` of every already-resolved track, in
   *   the order they currently sit in the playlist (length = current track count).
   *   Used by the modal to interleave newly-picked missing rows by their original
   *   Spotify `playlistOrder` instead of appending blindly at the end. Empty or
   *   misaligned arrays make the modal fall back to append.
   * - `create_youtube_only`: unused; pass `[]`.
   */
  resolvedSourceOrders: number[];
  unresolvedRows: M3uUnresolvedImportRow[];
  /** Defaults to `merge_with_locals` when omitted. */
  mode?: M3uYoutubeResolveSaveMode;
  /** Header subtitle hint (e.g. "Spotify playlist — Owner"). Omitted for M3U import. */
  sourceLabel?: string;
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
