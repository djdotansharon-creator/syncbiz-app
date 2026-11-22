/**
 * THE LIBRARY SHOWS A LOCAL PLAYLIST ONLY IN ITS OWN BRANCH (owner 2026-11-22; Dotan: "it does not matter to us if playlists created on the Lenovo disappear from other computers — make the change and reset").
 * A playlist of music FILES exists only on the computer that built it, so it belongs to that computer's branch and is not offered anywhere else. Playlists of links (YouTube, the web, a radio) are
 * not touched — they stay as they are until sharing between branches exists. Pure: it only decides what the library DRAWS; nothing is deleted, moved or sent anywhere, and playback never reads this list.
 *
 *   · `viewBranch` = the branch of THIS window: the desktop app's own branch (MAIN's config), or — in a browser / phone — the branch chosen at the top (the last one used). Unknown (the desktop
 *     has not answered yet) = show everything, exactly as before.
 *   · the legacy key "default" and the workspace's canonical branch are one branch (`sameBranch`).
 */
import { sameBranch } from "./local-playlist-branch";
import { playlistHasLocalFiles } from "./playlist-playability";
import type { UnifiedSource } from "./source-types";

/** true when this library row is a playlist (or a song of one) made of local files that belongs to ANOTHER branch than `viewBranch`. */
export function isLocalPlaylistOfAnotherBranch(source: UnifiedSource, viewBranch: string | null | undefined, canonicalDefaultBranchId: string | null): boolean {
  const view = (viewBranch ?? "").trim();
  if (!view) return false;
  if (source.origin !== "playlist" || !source.playlist) return false;
  if (!playlistHasLocalFiles(source.playlist)) return false;
  return !sameBranch(source.playlist.branchId, view, canonicalDefaultBranchId);
}

/** the library list for this window: everything, minus the local playlists of other branches. Returns the SAME array when nothing is hidden (no needless re-render). */
export function libraryForBranch(sources: UnifiedSource[], viewBranch: string | null | undefined, canonicalDefaultBranchId: string | null): UnifiedSource[] {
  if (!(viewBranch ?? "").trim()) return sources;
  const kept = sources.filter((s) => !isLocalPlaylistOfAnotherBranch(s, viewBranch, canonicalDefaultBranchId));
  return kept.length === sources.length ? sources : kept;
}
