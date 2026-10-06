/**
 * Validates schedule targets: ensures target exists and belongs to the schedule's branch.
 * Used when creating or updating schedules.
 *
 * Execution: the web app runs `ScheduleAutoPlayer` (client) while a tab is open — see
 * `lib/schedule-window.ts` and `components/schedule-auto-player.tsx`. Endpoint agents still
 * receive commands via existing APIs; full device-side scheduling is separate.
 */

import { db } from "@/lib/store";
import { playlistHasHttpPlayableUrl } from "@/lib/playlist-playability";
import { getPlaylist } from "@/lib/playlist-store";
import { getRadioStation } from "@/lib/radio-store";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import type { ScheduleTargetType } from "@/lib/types";
import { contentBranchesEquivalent } from "@/lib/branch-resolver";

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
): Promise<TargetValidationResult> {
  const bid = (branchId ?? "").trim() || "default";
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
      if (!(await contentBranchesEquivalent(workspaceId, playlistBranch, bid))) {
        return { ok: false, error: "Playlist belongs to a different branch" };
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

    default:
      return { ok: false, error: `Unsupported targetType: ${targetType}` };
  }
}
