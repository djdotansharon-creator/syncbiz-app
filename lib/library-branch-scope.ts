/**
 * THE LIBRARY SHOWS A PLAYLIST ONLY IN ITS OWN BRANCH — or where it was SHARED (owner + Dotan 2026-11-22/23: "a playlist appears only in its branch or in the branches it was shared with"; the earlier step, #237, hid only the
 * playlists of local files). A playlist of music FILES exists only on the computer that built it; a playlist of links belongs to the branch that made it and reaches other branches ONLY through sharing (the "Shared" view,
 * lib/shared-playlist-source.ts) — it is no longer drawn everywhere. Pure: it only decides what the library DRAWS; nothing is deleted, moved or sent anywhere, and playback never reads this list. Plain sources and radios
 * are not playlists and are never hidden.
 *
 *   · `viewBranch` = the branch of THIS window: the desktop app's own branch (MAIN's config), or — in a browser / phone — the branch chosen at the top (the last one used). Unknown (the desktop has not answered yet)
 *     = show everything, exactly as before.
 *   · the legacy key "default" and the workspace's canonical branch are one branch (`sameBranch`).
 */
import { sameBranch } from "./local-playlist-branch";
import { playlistHasLocalFiles } from "./playlist-playability";
import type { UnifiedSource } from "./source-types";

/** true when this library row is a playlist (or a song of one) that belongs to ANOTHER branch than `viewBranch`. */
export function isPlaylistOfAnotherBranch(source: UnifiedSource, viewBranch: string | null | undefined, canonicalDefaultBranchId: string | null): boolean {
  const view = (viewBranch ?? "").trim();
  if (!view) return false;
  if (source.origin !== "playlist" || !source.playlist) return false;
  return !sameBranch(source.playlist.branchId, view, canonicalDefaultBranchId);
}

/** the narrower rule of #237 (kept for its guard): a playlist of LOCAL files that belongs to another branch. */
export function isLocalPlaylistOfAnotherBranch(source: UnifiedSource, viewBranch: string | null | undefined, canonicalDefaultBranchId: string | null): boolean {
  return isPlaylistOfAnotherBranch(source, viewBranch, canonicalDefaultBranchId) && !!source.playlist && playlistHasLocalFiles(source.playlist);
}

/** the library list for this window: everything, minus the playlists of other branches. Returns the SAME array when nothing is hidden (no needless re-render). */
export function libraryForBranch(sources: UnifiedSource[], viewBranch: string | null | undefined, canonicalDefaultBranchId: string | null): UnifiedSource[] {
  if (!(viewBranch ?? "").trim()) return sources;
  const kept = sources.filter((s) => !isPlaylistOfAnotherBranch(s, viewBranch, canonicalDefaultBranchId));
  return kept.length === sources.length ? sources : kept;
}
