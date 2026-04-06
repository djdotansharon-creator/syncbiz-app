import type { Playlist } from "./playlist-types";
import type { Source } from "./types";
import { unifiedPlaylistSourceId } from "./playlist-utils";

/** Unified library item: either a Playlist or a Source. */
export type LibraryItemKind = "playlist" | "source";

export type LibraryItem =
  | { kind: "playlist"; data: Playlist }
  | { kind: "source"; data: Source };

export function isPlaylist(item: LibraryItem): item is { kind: "playlist"; data: Playlist } {
  return item.kind === "playlist";
}

export function isSource(item: LibraryItem): item is { kind: "source"; data: Source } {
  return item.kind === "source";
}

/** Display name for a library item. */
export function getLibraryItemName(item: LibraryItem): string {
  return item.kind === "playlist" ? item.data.name : item.data.name;
}

/** Cover/thumbnail URL for a library item. */
export function getLibraryItemCover(item: LibraryItem): string | null {
  if (item.kind === "playlist") {
    return item.data.thumbnail || null;
  }
  return item.data.artworkUrl || null;
}

/** Unique ID for a library item. */
export function getLibraryItemId(item: LibraryItem): string {
  return item.kind === "playlist" ? unifiedPlaylistSourceId(item.data.id) : `src-${item.data.id}`;
}
