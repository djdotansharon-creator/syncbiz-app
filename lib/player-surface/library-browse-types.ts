import type { ReactNode } from "react";

/** Presentational library tile — shared by branch desktop grid and web SourceCard body. */
export type LibraryBrowseCardSurfaceProps = {
  /** `button` = desktop branch grid; `div` = embedded in web SourceCard article */
  as: "button" | "div";
  /** Shown when `artSlot` is not provided (desktop). */
  artworkUrl?: string | null;
  /** Top-left badge on default art (desktop). Omit or "" when `artSlot` provides custom art (web). */
  originBadgeLabel?: string;
  /** Replace default art block (web: HydrationSafeImage + overlays). */
  artSlot?: ReactNode;
  title: string;
  /** Primary subtitle line under title (ignored when `metaSlot` set). */
  metaLine: string;
  /** Optional richer meta row (web); when set, replaces default meta line. */
  metaSlot?: ReactNode;
  /** Right side of title row (web: favorite + provider logo). */
  titleAside?: ReactNode;
  selected?: boolean;
  className?: string;
  /** Web: action row under meta (LibrarySourceItemActions). */
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  type?: "button" | "submit" | "reset";
};
