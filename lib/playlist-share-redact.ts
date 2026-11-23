/**
 * WHAT A RECEIVER IS ALLOWED TO SEE OF A SHARED PLAYLIST (owner 2026-11-23, sharing phase D — the cross-business security rule). PURE.
 * A share is a READ-ONLY window onto one playlist. The receiver — a branch of the same business, or a PERSON in another business — gets a WHITELISTED copy of the data: the playlist's name, genre, picture,
 * its songs (name, type, picture, length, and an address ONLY when it is a web address). Nothing else leaves the sender's business: no workspace / branch / creator ids, no notes, no catalog links, no schedule
 * blocks — and NEVER a local file's path (CLAUDE.md §12): a local song reaches the receiver as a name only, so it can be drawn grey.
 */
import type { Playlist, PlaylistTrack } from "./playlist-types";

const isWeb = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u.trim());
const picture = (u: unknown): string | undefined => (isWeb(u) || (typeof u === "string" && /^data:image\//i.test(u.trim())) ? (u as string) : undefined);

export function redactPlaylistForShare(p: Playlist): Playlist {
  const tracks: PlaylistTrack[] = (p.tracks ?? []).map((t) => {
    const local = t.type === "local" || t.type === "winamp" || !isWeb(t.url);
    const out: PlaylistTrack = {
      id: String(t.id ?? ""),
      name: String(t.name ?? ""),
      type: local ? ("local" as PlaylistTrack["type"]) : t.type,
      url: local ? "" : (t.url as string),
    };
    const cover = picture(t.cover);
    if (cover) out.cover = cover;
    if (typeof t.durationSeconds === "number" && t.durationSeconds > 0) out.durationSeconds = t.durationSeconds;
    return out;
  });
  const cover = picture(p.cover) ?? picture(p.thumbnail);
  const out: Playlist = {
    id: p.id,
    name: p.name,
    genre: p.genre ?? "",
    type: p.type,
    url: isWeb(p.url) ? p.url : "",
    thumbnail: cover ?? "",
    createdAt: p.createdAt,
    tracks,
  } as Playlist;
  if (cover) out.cover = cover;
  if (typeof p.durationSeconds === "number" && p.durationSeconds > 0) out.durationSeconds = p.durationSeconds;
  if (p.createdByName) out.createdByName = p.createdByName;
  return out;
}
