/**
 * Validates schedule targets: ensures target exists and belongs to the schedule's branch.
 * Used when creating or updating schedules.
 *
 * Execution: the web app runs `ScheduleAutoPlayer` (client) while a tab is open — see
 * `lib/schedule-window.ts` and `components/schedule-auto-player.tsx`. Endpoint agents still
 * receive commands via existing APIs; full device-side scheduling is separate.
 */

import { db } from "@/lib/store";
import { playlistHasHttpPlayableUrl, playlistHasLocalFiles } from "@/lib/playlist-playability";
import { decidePlaylistBranchUse } from "@/lib/schedule-branch-use";
import { getPlaylist } from "@/lib/playlist-store";
import { getRadioStation } from "@/lib/radio-store";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import type { ScheduleTargetType } from "@/lib/types";
import { contentBranchesEquivalent } from "@/lib/branch-resolver";
import { accessiblePrivateBanks } from "@/lib/music-bank/bank-access";
import { POC_MUSIC_BANK_CATALOG } from "@/lib/music-bank/poc-catalog";

export type TargetValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate that a schedule target exists and belongs to the given branch.
 * Rejects cross-branch targets. Gate 2B-1: the legacy key "default" and the workspace's canonical branch are the
 * same branch (same-workspace alias only; `workspaceId` = the caller's workspace — without it, exact match).
 */
export async function validateScheduleTarget(
  branchId: string,
  targetType: ScheduleTargetType,
  targetId: string,
  workspaceId?: string | null,
  /** 2026-11-22: may the caller use this branch (its content)? When given, a playlist of URLs from ANOTHER branch of the same business is allowed (lib/schedule-branch-use.ts). Omitted = the old strict rule. */
  callerCanUseBranch?: (branchId: string) => Promise<boolean>,
): Promise<TargetValidationResult> {
  const bid = (branchId ?? "").trim() || "default";
  // a quiet block has no music to look up (it only stops the music at its start)
  if (targetType === "SILENCE") return { ok: true };
  const tid = (targetId ?? "").trim();
  if (!tid) {
    return { ok: false, error: "targetId is required" };
  }

  switch (targetType) {
    case "SOURCE": {
      const sources = await db.getSources();
      const source = sources.find((s) => s.id === tid);
      if (!source) {
        return { ok: false, error: "Source not found" };
      }
      const sourceBranch = (source.branchId ?? "default").trim() || "default";
      if (!(await contentBranchesEquivalent(workspaceId, sourceBranch, bid))) {
        return { ok: false, error: "Source belongs to a different branch" };
      }
      return { ok: true };
    }

    case "PLAYLIST": {
      const playlist = await getPlaylist(tid);
      if (!playlist) {
        return { ok: false, error: "Playlist not found" };
      }
      const playlistBranch = resolveMediaBranchId(playlist);
      const sameBranch = await contentBranchesEquivalent(workspaceId, playlistBranch, bid);
      const hasLocalFiles = playlistHasLocalFiles(playlist);
      let callerCanUsePlaylistBranch: boolean | null = null;
      if (!sameBranch && !hasLocalFiles && callerCanUseBranch) {
        try {
          callerCanUsePlaylistBranch = await callerCanUseBranch(playlistBranch);
        } catch {
          callerCanUsePlaylistBranch = false; // cannot tell → the old strict rule
        }
      }
      const use = decidePlaylistBranchUse({ sameBranch, hasLocalFiles, callerCanUsePlaylistBranch });
      if (!use.ok) return use;
      // A LOCAL / winamp playlist plays on a designated station via MAIN/mpv (local files on that machine). Its file
      // paths never reach the server (CLAUDE.md §12), so the server can never see an HTTP url and must NOT reject it
      // as "catalog-only" — the station checks playability at play time. Non-local playlists still require an HTTP url.
      if (playlist.type === "local" || playlist.type === "winamp") {
        return { ok: true };
      }
      if (!playlistHasHttpPlayableUrl(playlist)) {
        return {
          ok: false,
          error:
            "Playlist has no playable HTTP URL (unresolved shell or catalog-only). Add tracks or pick another playlist.",
        };
      }
      return { ok: true };
    }

    case "RADIO": {
      const station = await getRadioStation(tid);
      if (!station) {
        return { ok: false, error: "Radio station not found" };
      }
      const radioBranch = resolveMediaBranchId(station);
      if (!(await contentBranchesEquivalent(workspaceId, radioBranch, bid))) {
        return { ok: false, error: "Radio station belongs to a different branch" };
      }
      return { ok: true };
    }

    case "BANK": {
      // a royalty-free music bank is not branch content: a public Genre Pack, or a private bank this business was opened to (the media token enforces it again at play time)
      if (POC_MUSIC_BANK_CATALOG.genres.some((g) => g.id === tid)) return { ok: true };
      const mine = await accessiblePrivateBanks({ workspaceId: workspaceId ?? null });
      return mine.some((b) => b.id === tid) ? { ok: true } : { ok: false, error: "Music bank not found, or not opened for this business" };
    }

    default:
      return { ok: false, error: `Unsupported targetType: ${targetType}` };
  }
}
