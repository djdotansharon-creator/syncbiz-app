/**
 * Resolve whether an authenticated user may use a persisted playlist row as an AI seed.
 * Tenant isolation: foreign playlists remain invisible unless OPTED IN via platform publication scopes only.
 */

import type { Playlist } from "@/lib/playlist-types";
import { gatePlaylistAccess, playlistTenantMatches, type PlaylistAccessUser } from "@/lib/playlist-access";
import { getPlaylist } from "@/lib/playlist-store";
import type { User } from "@/lib/user-types";

const GLOBAL_DNA_PUBLICATION_SCOPES = new Set<string>(["OFFICIAL_SYNCBIZ", "TEMPLATE"]);

function userToPlaylistAccess(user: User): PlaylistAccessUser {
  return { id: user.id, tenantId: user.tenantId };
}

export async function resolvePlaylistForAiSeed(
  user: User | null,
  seedPlaylistId: string,
): Promise<
  | { ok: true; playlist: Playlist }
  | { ok: false; status: 401 | 403 | 404; message: string }
> {
  if (!user) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  const id = seedPlaylistId.trim();
  if (!id) {
    return { ok: false, status: 404, message: "Playlist not found" };
  }

  const playlist = await getPlaylist(id);
  if (!playlist) {
    return { ok: false, status: 404, message: "Playlist not found" };
  }

  if (playlistTenantMatches(userToPlaylistAccess(user), playlist)) {
    const g = await gatePlaylistAccess(userToPlaylistAccess(user), playlist);
    if (!g.allow) {
      return { ok: false, status: g.httpStatus, message: g.message };
    }
    return { ok: true, playlist };
  }

  const scope = playlist.publicationScope ?? "PRIVATE";
  if (GLOBAL_DNA_PUBLICATION_SCOPES.has(scope)) {
    return { ok: true, playlist };
  }

  return { ok: false, status: 404, message: "Playlist not found" };
}
