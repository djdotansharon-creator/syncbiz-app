/**
 * Which persisted playlists belong in DJ Creator AI surfaces (hub + assistant list).
 * AI Builder writes genre "AI Playlist"; legacy wizard saves use "DJ Creator".
 */

import { classifyLibraryEntityContract, type UnifiedSource } from "@/lib/source-types";

export const AI_PLAYLIST_GENRE = "AI Playlist";
export const DJ_CREATOR_SAVED_GENRE = "DJ Creator";

const DJ_CREATOR_GENRES = new Set([AI_PLAYLIST_GENRE, DJ_CREATOR_SAVED_GENRE]);

export function playlistGenreLabel(source: UnifiedSource): string {
  return String(source.genre ?? source.playlist?.genre ?? "").trim();
}

/** SyncBiz playlist created by AI Builder or saved from the DJ Creator wizard. */
export function isDjCreatorAiWorkspacePlaylist(source: UnifiedSource): boolean {
  if (source.origin !== "playlist" || !source.playlist?.id) return false;
  if (!DJ_CREATOR_GENRES.has(playlistGenreLabel(source))) return false;
  if (source.playlist.libraryPlacement === "ready_external") return false;
  const contract = classifyLibraryEntityContract(source);
  if (contract.entityKind === "collection" && contract.collectionSubtype === "external_playlist") {
    return false;
  }
  return true;
}
