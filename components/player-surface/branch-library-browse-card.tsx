"use client";

import type { ReactNode } from "react";
import { LibraryBrowseCardSurface } from "@/components/player-surface/library-browse-card-surface";
import { libraryOriginBadgeLabel } from "@/lib/player-surface/library-origin-badge";
import {
  branchLibraryItemMetaLine,
  type BranchLibraryListItem,
} from "@/lib/player-surface/branch-library-list-item";
import "@/components/player-surface/library-browse-card-surface.css";

export type BranchLibraryBrowseCardInteraction = "gridButton" | "embeddedDiv";

export type BranchLibraryBrowseCardProps =
  | {
      item: BranchLibraryListItem;
      selected: boolean;
      interaction: "gridButton";
      onSelect: (item: BranchLibraryListItem) => void;
      className?: string;
      titleAside?: undefined;
      children?: undefined;
      "aria-label"?: string;
    }
  | {
      item: BranchLibraryListItem;
      selected: boolean;
      interaction: "embeddedDiv";
      onSelect?: undefined;
      className?: string;
      titleAside?: ReactNode;
      children?: ReactNode;
      "aria-label"?: string;
    };

export function BranchLibraryBrowseCard(props: BranchLibraryBrowseCardProps) {
  const {
    item,
    selected,
    interaction,
    className = "",
    titleAside,
    children,
    "aria-label": ariaLabel,
  } = props;
  const metaLine = branchLibraryItemMetaLine(item);
  const originBadge = libraryOriginBadgeLabel(item.origin);

  if (interaction === "gridButton") {
    return (
      <LibraryBrowseCardSurface
        as="button"
        type="button"
        className={className}
        artworkUrl={item.cover}
        originBadgeLabel={originBadge}
        title={item.title}
        metaLine={metaLine}
        selected={selected}
        aria-label={ariaLabel ?? `${item.title}, ${item.origin}, ${item.type}`}
        aria-pressed={selected}
        onClick={() => props.onSelect(item)}
      />
    );
  }

  return (
    <LibraryBrowseCardSurface
      as="div"
      className={className}
      artworkUrl={item.cover}
      originBadgeLabel={originBadge}
      title={item.title}
      metaLine={metaLine}
      metaSlot={undefined}
      titleAside={titleAside}
      selected={selected}
    >
      {children}
    </LibraryBrowseCardSurface>
  );
}
