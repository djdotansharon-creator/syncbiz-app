/** Shape used by shared branch library grid — matches `BranchLibraryItem` from desktop MVP types. */

import { formatDuration } from "@/lib/format-utils";

export type BranchLibraryListItem = {
  id: string;
  title: string;
  origin: "playlist" | "radio" | "source";
  /** LIST, SINGLE, SET, or Radio (art badge). */
  kindBadge?: string;
  /** Only for LIST containers: number of child URLs / tracks. */
  listTrackCount?: number;
  listDurationSecondsTotal?: number | null;
  type: string;
  genre: string;
  cover: string | null;
};

export function branchLibraryItemMetaLine(it: BranchLibraryListItem): string {
  const badge = it.kindBadge ?? "";
  if (badge === "LIST" && typeof it.listTrackCount === "number") {
    const n = it.listTrackCount;
    const countLabel = n === 1 ? "1 item" : `${n} items`;
    const dur =
      typeof it.listDurationSecondsTotal === "number" && it.listDurationSecondsTotal > 0
        ? formatDuration(it.listDurationSecondsTotal)
        : "";
    return [countLabel, dur].filter(Boolean).join(" · ");
  }

  const g = it.genre?.trim() && it.genre !== "—" ? it.genre : "";
  if (badge === "Radio") {
    return [g, "Radio"].filter(Boolean).join(" · ") || "Radio";
  }
  const typeLabel = badge === "SET" ? "Set" : badge === "SINGLE" ? "Single" : it.type;
  return [g, typeLabel].filter(Boolean).join(" · ") || typeLabel;
}
