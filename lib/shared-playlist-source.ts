/**
 * A playlist SHARED INTO this branch, drawn and played like any other playlist of the library (owner 2026-11-22, sharing phase C). PURE helpers.
 * The playlist's songs travel with the share (names, addresses, covers) — never a local file: a song that is a file on another computer is "unavailable" here and is drawn grey.
 */
import type { Playlist } from "./playlist-types";
import type { SourceProviderType, UnifiedSource } from "./source-types";
import { expandPlaylistEntityToItems } from "./syncbiz-playlist-queue";

/** the playlist as a library source (its own id space, so it never collides with this branch's own playlists) */
export function sharedPlaylistToSource(p: Playlist): UnifiedSource {
  return {
    id: `shared-${p.id}`,
    title: p.name,
    genre: p.genre || "Mixed",
    cover: p.cover || p.thumbnail || null,
    type: (p.type ?? "stream-url") as SourceProviderType,
    url: p.url,
    origin: "playlist",
    playlist: p,
  };
}

/** its songs as library rows, in the playlist's order */
export function sharedPlaylistLeaves(p: Playlist): UnifiedSource[] {
  return expandPlaylistEntityToItems(sharedPlaylistToSource(p));
}

/** true for a song that exists only as a file on one computer: local / winamp, or an address that is not http(s) */
export function isLocalOnlyLeaf(leaf: Pick<UnifiedSource, "type" | "url">): boolean {
  if (leaf.type === "local" || leaf.type === "winamp") return true;
  const u = (leaf.url ?? "").trim();
  return !(u.startsWith("http://") || u.startsWith("https://"));
}
