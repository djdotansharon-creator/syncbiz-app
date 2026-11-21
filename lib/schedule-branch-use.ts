/**
 * May a schedule block of branch B play a PLAYLIST that belongs to branch A? (PURE, 2026-11-22)
 *
 * Field test 2026-11-21: every playlist made in the app is saved in branch "default", while a station follows only its OWN branch — so a block made from such a playlist
 * landed in "default" and never ran on the Lenovo (branch Lenovo-Pailot). Owner: playlists made of URLs should be usable by every branch of the business; playlists of
 * MP3 files on a computer exist only on that computer, so they stay with the branch that owns them.
 *
 *   · same branch (the legacy "default" alias is resolved by the caller)       → allowed, as always
 *   · a playlist of local files in another branch                              → refused, with the reason
 *   · a playlist of URLs in another branch of the same business               → allowed ONLY when the caller may use that branch too
 *   · anything else (the caller did not say, or may not use that branch)      → refused: "belongs to a different branch", as before
 */
export type PlaylistBranchUse = { ok: true } | { ok: false; error: string };

export function decidePlaylistBranchUse(i: {
  sameBranch: boolean;
  hasLocalFiles: boolean;
  /** does the caller have access to the playlist's own branch? null = not asked (an older caller) */
  callerCanUsePlaylistBranch: boolean | null;
}): PlaylistBranchUse {
  if (i.sameBranch) return { ok: true };
  if (i.hasLocalFiles) {
    return {
      ok: false,
      error:
        "This playlist plays music files that exist only on the computer that built it, so it belongs to that computer's branch and cannot be scheduled on another branch.",
    };
  }
  if (i.callerCanUsePlaylistBranch === true) return { ok: true };
  return { ok: false, error: "Playlist belongs to a different branch" };
}
