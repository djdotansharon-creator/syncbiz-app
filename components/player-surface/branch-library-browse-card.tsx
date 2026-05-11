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

type OriginBadgeOpts = { originBadgeClassName?: string };

export type BranchLibraryBrowseCardProps =
  | ({
      item: BranchLibraryListItem;
      selected: boolean;
      interaction: "gridButton";
      onSelect: (item: BranchLibraryListItem) => void;
      className?: string;
      titleAside?: undefined;
      children?: undefined;
      "aria-label"?: string;
    } & OriginBadgeOpts)
  | ({
      item: BranchLibraryListItem;
      selected: boolean;
      interaction: "embeddedDiv";
      onSelect?: undefined;
      className?: string;
      titleAside?: ReactNode;
      children?: ReactNode;
      "aria-label"?: string;
      /** Top-right overlay on artwork (leaf provider mark). */
      artTopRightSlot?: ReactNode;
      /** When set, replaces default meta line under title (e.g. genre + chip row). */
      surfaceMetaSlot?: ReactNode;
    } & OriginBadgeOpts);

export function BranchLibraryBrowseCard(props: BranchLibraryBrowseCardProps) {
  const {
    item,
    selected,
    interaction,
    className = "",
    titleAside,
    children,
    "aria-label": ariaLabel,
    originBadgeClassName = "",
  } = props;
  const metaLine = branchLibraryItemMetaLine(item);
  const originBadge = item.kindBadge?.trim() ? item.kindBadge : libraryOriginBadgeLabel(item.origin);
  const surfaceMetaSlot =
    interaction === "embeddedDiv" && "surfaceMetaSlot" in props ? props.surfaceMetaSlot : undefined;

  const artTopRightSlot =
    interaction === "embeddedDiv" && "artTopRightSlot" in props ? props.artTopRightSlot : undefined;

  if (interaction === "gridButton") {
    return (
      <LibraryBrowseCardSurface
        as="button"
        type="button"
        className={className}
        artworkUrl={item.cover}
        mediaPlaceholderChip={item.mediaPlaceholderChip}
        originBadgeLabel={originBadge}
        originBadgeClassName={originBadgeClassName}
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
      mediaPlaceholderChip={item.mediaPlaceholderChip}
      originBadgeLabel={originBadge}
      originBadgeClassName={originBadgeClassName}
      artTopRightSlot={artTopRightSlot}
      title={item.title}
      metaLine={surfaceMetaSlot ? "" : metaLine}
      metaSlot={surfaceMetaSlot}
      titleAside={titleAside}
      selected={selected}
    >
      {children}
    </LibraryBrowseCardSurface>
  );
}
