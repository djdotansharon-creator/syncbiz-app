/**
 * Validates schedule targets: ensures target exists and belongs to the schedule's branch.
 * Used when creating or updating schedules.
 *
 * Execution: the web app runs `ScheduleAutoPlayer` (client) while a tab is open — see
 * `lib/schedule-window.ts` and `components/schedule-auto-player.tsx`. Endpoint agents still
 * receive commands via existing APIs; full device-side scheduling is separate.
 */

import { db } from "@/lib/store";
import { getPlaylist } from "@/lib/playlist-store";
import { getRadioStation } from "@/lib/radio-store";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import type { ScheduleTargetType } from "@/lib/types";

export type TargetValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate that a schedule target exists and belongs to the given branch.
 * Rejects cross-branch targets.
 */
export async function validateScheduleTarget(
  branchId: string,
  targetType: ScheduleTargetType,
  targetId: string,
): Promise<TargetValidationResult> {
  const bid = (branchId ?? "").trim() || "default";
  const tid = (targetId ?? "").trim();
  if (!tid) {
    return { ok: false, error: "targetId is required" };
  }

  switch (targetType) {
    case "SOURCE": {
      const sources = db.getSources();
      const source = sources.find((s) => s.id === tid);
      if (!source) {
        return { ok: false, error: "Source not found" };
      }
      const sourceBranch = (source.branchId ?? "default").trim() || "default";
      if (sourceBranch !== bid) {
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
      if (playlistBranch !== bid) {
        return { ok: false, error: "Playlist belongs to a different branch" };
      }
      return { ok: true };
    }

    case "RADIO": {
      const station = await getRadioStation(tid);
      if (!station) {
        return { ok: false, error: "Radio station not found" };
      }
      const radioBranch = resolveMediaBranchId(station);
      if (radioBranch !== bid) {
        return { ok: false, error: "Radio station belongs to a different branch" };
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unsupported targetType: ${targetType}` };
  }
}
