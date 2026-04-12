"use client";

import { BranchLibraryBrowseCard } from "@/components/player-surface/branch-library-browse-card";
import type { BranchLibraryListItem } from "@/lib/player-surface/branch-library-list-item";

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
        />
      ))}
    </>
  );
}
