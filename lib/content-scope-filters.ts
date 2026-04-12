/**
 * API/content filtering for branch vs OWNER personal bank.
 * Legacy playlists have no `playlistOwnershipScope` → treated as branch.
 */

import type { Playlist } from "@/lib/playlist-types";
import type { AccessType } from "@/lib/user-types";

/** Query param `scope` for unified sources and playlist lists. */
export type ApiContentScope = "branch" | "owner_personal";

export function parseApiContentScope(raw: string | null): ApiContentScope {
  return raw === "owner_personal" ? "owner_personal" : "branch";
}

/** Whether a playlist row should appear in the given API list scope. */
export function playlistMatchesApiScope(p: Playlist, scope: ApiContentScope): boolean {
  const ownership = p.playlistOwnershipScope ?? "branch";
  if (scope === "branch") return ownership !== "owner_personal";
  return ownership === "owner_personal";
}

/** OWNER-only bank; BRANCH_USER cannot use owner_personal scope. */
export function canRequestApiScope(scope: ApiContentScope, accessType: AccessType): boolean {
  if (scope === "owner_personal") return accessType === "OWNER";
  return true;
}
