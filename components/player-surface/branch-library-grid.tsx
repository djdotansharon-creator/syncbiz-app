"use client";

import { BranchLibraryBrowseCard } from "@/components/player-surface/branch-library-browse-card";
import type { BranchLibraryListItem } from "@/lib/player-surface/branch-library-list-item";
import { libraryKindBadgeArtClass } from "@/lib/library-display-classification";

function branchListBadgeArtClass(item: BranchLibraryListItem): string {
  const b = item.kindBadge;
  if (b === "LIST") return libraryKindBadgeArtClass("LIST");
  if (b === "SINGLE") return libraryKindBadgeArtClass("SINGLE");
  if (b === "SET") return libraryKindBadgeArtClass("SET");
  if (b === "Radio") return libraryKindBadgeArtClass("RADIO");
  return "";
}

export type BranchLibraryGridProps = {
  items: BranchLibraryListItem[];
  selectedId: string | null;
  errorMessage: string | null;
  emptyMessage: string;
  onSelect: (item: BranchLibraryListItem) => void;
};

export function BranchLibraryGrid({
  items,
  selectedId,
  errorMessage,
  emptyMessage,
  onSelect,
}: BranchLibraryGridProps) {
  if (errorMessage) {
    return <p className="sb-lbc-error">{errorMessage}</p>;
  }
  if (!items.length) {
    return <p className="sb-lbc-empty">{emptyMessage}</p>;
  }

  return (
    <>
      {items.map((it) => (
        <BranchLibraryBrowseCard
          key={it.id}
          interaction="gridButton"
          item={it}
          selected={selectedId === it.id}
          onSelect={onSelect}
          originBadgeClassName={branchListBadgeArtClass(it)}
        />
      ))}
    </>
  );
}
