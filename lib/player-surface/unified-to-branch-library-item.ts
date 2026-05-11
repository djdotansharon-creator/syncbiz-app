import type { UnifiedSource } from "@/lib/source-types";
import type { BranchLibraryListItem } from "@/lib/player-surface/branch-library-list-item";
import {
  libraryKindBadgeUpper,
  libraryListContainerMeta,
  resolveLibraryKindBadge,
} from "@/lib/library-display-classification";
import { inferTrackSourceChip } from "@/lib/track-source-chip";

/**
 * Maps a unified library row to the shared branch-library tile shape (desktop IPC + web adapters).
 */
export function unifiedSourceToBranchLibraryListItem(source: UnifiedSource): BranchLibraryListItem | null {
  if (source.origin !== "playlist" && source.origin !== "radio" && source.origin !== "source") {
    return null;
  }
  const kind = resolveLibraryKindBadge(source);
  const listMeta = kind === "LIST" && source.playlist ? libraryListContainerMeta(source) : null;
  return {
    id: source.id,
    title: source.title,
    origin: source.origin,
    kindBadge: libraryKindBadgeUpper(kind),
    listTrackCount: listMeta?.trackCount,
    listDurationSecondsTotal: listMeta?.durationSecondsTotal ?? undefined,
    type: source.type ?? "—",
    genre: source.genre?.trim() || "—",
    cover: source.cover ?? null,
    mediaPlaceholderChip: inferTrackSourceChip(source),
  };
}
