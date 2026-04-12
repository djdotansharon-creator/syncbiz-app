import type { UnifiedSource } from "@/lib/source-types";
import type { BranchLibraryListItem } from "@/lib/player-surface/branch-library-list-item";

/**
 * Maps a unified library row to the shared branch-library tile shape (desktop IPC + web adapters).
 * Returns null for synthetic / non-branch rows that should keep the rich SourceCard layout.
 */
export function unifiedSourceToBranchLibraryListItem(source: UnifiedSource): BranchLibraryListItem | null {
  if (source.id.includes(":track:")) return null;
  if (source.origin !== "playlist" && source.origin !== "radio" && source.origin !== "source") {
    return null;
  }
  return {
    id: source.id,
    title: source.title,
    origin: source.origin,
    type: source.type ?? "—",
    genre: source.genre?.trim() || "—",
    cover: source.cover ?? null,
  };
}
