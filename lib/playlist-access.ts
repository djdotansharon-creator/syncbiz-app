/**
 * Server-side access control for persisted playlists.
 * - Branch catalog (default / `playlistOwnershipScope` omitted or `branch`): `hasBranchAccess` on `branchId`.
 * - Owner personal bank (`owner_personal`): only `AccessType === "OWNER"` for the same tenant.
 */

import type { Playlist } from "@/lib/playlist-types";
import type { AccessType } from "@/lib/user-types";
import { hasBranchAccess } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { getAccessType } from "@/lib/user-store";

export type PlaylistAccessUser = {
  id: string;
  tenantId?: string;
};

export type PlaylistGateResult =
  | { allow: true; user: PlaylistAccessUser }
  | { allow: false; httpStatus: 401 | 403 | 404; message: string };

/** Same tenant as persisted playlist row (demo tenant compatibility). */
export function playlistTenantMatches(user: PlaylistAccessUser, playlist: Playlist): boolean {
  if (playlist.tenantId && playlist.tenantId !== user.tenantId) return false;
  if (!playlist.tenantId && user.tenantId !== "tnt-default") return false;
  return true;
}

/**
 * Unified gate for GET/PUT/DELETE/play/refresh on a single playlist document.
 */
export async function gatePlaylistAccess(
  user: PlaylistAccessUser | null,
  playlist: Playlist | null,
): Promise<PlaylistGateResult> {
  if (!user) {
    return { allow: false, httpStatus: 401, message: "Unauthorized" };
  }
  if (!playlist) {
    return { allow: false, httpStatus: 404, message: "Playlist not found" };
  }
  if (!playlistTenantMatches(user, playlist)) {
    return { allow: false, httpStatus: 404, message: "Playlist not found" };
  }
  const accessType: AccessType = await getAccessType(user.id, user.tenantId ?? null);
  const scope = playlist.playlistOwnershipScope ?? "branch";
  if (scope === "owner_personal") {
    if (accessType !== "OWNER") {
      return { allow: false, httpStatus: 403, message: "Forbidden: owner personal playlist" };
    }
    return { allow: true, user };
  }
  const branchId = resolveMediaBranchId(playlist);
  if (!(await hasBranchAccess(user.id, branchId))) {
    return { allow: false, httpStatus: 403, message: "Forbidden: no access to this branch" };
  }
  return { allow: true, user };
}
