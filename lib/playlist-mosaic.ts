/**
 * A playlist's cover as the pictures of its FIRST FOUR songs side by side (owner 2026-11-24: "like Spotify — made of the 4 rectangles of the first 4 songs"; a picture the user chose themselves comes another time). PURE.
 *
 * Shown only when it is honest: the playlist has at least four songs with a picture, and its own cover is NOT a picture somebody picked on purpose. Until a way to choose a cover exists, a stored cover that is just
 * one of the playlist's own songs' pictures (what the app fills in by itself) counts as "not chosen"; anything else (a pasted address, an uploaded image) is kept as the one cover it always was.
 * Fewer than four pictures → null → the single cover shown today, unchanged.
 */
import { getPlaylistTracks, type Playlist } from "@/lib/playlist-types";
import { derivePlaylistTrackCoverArt, getYouTubeThumbnail, getYouTubeVideoId } from "@/lib/playlist-utils";

const VI = /\/vi(?:_webp)?\/([\w-]{11})\//;
const viId = (u: string): string | null => VI.exec(u)?.[1] ?? null;

export function playlistMosaicCovers(p: Playlist): string[] | null {
  const tracks = getPlaylistTracks(p);
  const covers: string[] = [];
  const ids = new Set<string>();
  for (const t of tracks) {
    const c = derivePlaylistTrackCoverArt(t);
    const vid = getYouTubeVideoId(`${t.url ?? ""}`) ?? (c ? viId(c) : null);
    if (vid) ids.add(vid);
    if (c) covers.push(c);
  }
  if (covers.length < 4) return null;

  const own = `${p.thumbnail ?? ""}`.trim() || `${p.cover ?? ""}`.trim();
  if (own) {
    const rootThumb = getYouTubeThumbnail(`${p.url ?? ""}`);
    const ownVid = viId(own);
    const auto = covers.includes(own) || own === rootThumb || (ownVid !== null && ids.has(ownVid));
    if (!auto) return null; // a picture somebody chose: it stays the one cover
  }
  return covers.slice(0, 4);
}
