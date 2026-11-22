/**
 * A playlist of LOCAL music files belongs to the computer that holds the files — and so to that computer's branch (owner 2026-11-22, PURE: imports nothing).
 *
 * Two small rules, both about the same fact:
 *   1. `withStationBranch` — a playlist of local files made on a computer is saved in THAT computer's branch from the start (the library used to send no branch, so every one
 *      landed in "default" and could never be scheduled on the station that owns the music). A computer that was never activated (branch "default" / nothing) sends nothing —
 *      exactly as before.
 *   2. `decideLocalPlaylistMove` — moving an already-saved local playlist to this computer's branch is an explicit, confirmed act. The server allows it only for a playlist that
 *      really plays local files (a URL playlist is usable by every branch and has no reason to move) and only to a branch the caller may use.
 */

export const LEGACY_BRANCH_KEY = "default";

/** The legacy key "default" and the workspace's canonical branch are the same branch (Branch.legacyKey); everything else is compared as written. */
export function sameBranch(a: string | null | undefined, b: string | null | undefined, canonicalDefaultBranchId: string | null): boolean {
  const canon = (x: string | null | undefined): string => {
    const v = (x ?? "").trim() || LEGACY_BRANCH_KEY;
    return v === LEGACY_BRANCH_KEY && canonicalDefaultBranchId ? canonicalDefaultBranchId : v;
  };
  return canon(a) === canon(b);
}

/** The body of a playlist-create request for a LOCAL playlist: the station's branch is added only when it is a real, activated branch. */
export function withStationBranch<T extends Record<string, unknown>>(body: T, stationBranch: string | null | undefined): T | (T & { branchId: string }) {
  const b = (stationBranch ?? "").trim();
  if (!b || b === LEGACY_BRANCH_KEY) return body;
  return { ...body, branchId: b };
}

/**
 * Should the Studio OFFER to move this playlist to the computer's own branch when it is dropped on the schedule?
 * Yes only when: it plays local files, it is in another branch, and we are in the desktop app (the one place where "this computer" is the computer of that branch).
 */
export function shouldOfferLocalMove(i: {
  hasLocalFiles: boolean;
  playlistBranch: string | null | undefined;
  ownBranch: string | null | undefined;
  canonicalDefaultBranchId: string | null;
  isDesktop: boolean;
}): boolean {
  if (!i.isDesktop || !i.hasLocalFiles) return false;
  const own = (i.ownBranch ?? "").trim();
  if (!own) return false;
  return !sameBranch(i.playlistBranch, own, i.canonicalDefaultBranchId);
}

export type LocalPlaylistMove = { ok: true; noop: boolean } | { ok: false; status: 400 | 403; error: string };

/** The server's decision for POST /api/playlists/:id/move-to-branch. */
export function decideLocalPlaylistMove(i: {
  hasLocalFiles: boolean;
  alreadyThere: boolean;
  callerCanUseTargetBranch: boolean;
}): LocalPlaylistMove {
  if (!i.callerCanUseTargetBranch) return { ok: false, status: 403, error: "Forbidden: no access to this branch" };
  if (!i.hasLocalFiles) {
    return { ok: false, status: 400, error: "Only a playlist of music files from a computer is moved this way - a playlist of links can be used by every branch as it is." };
  }
  return { ok: true, noop: i.alreadyThere };
}
