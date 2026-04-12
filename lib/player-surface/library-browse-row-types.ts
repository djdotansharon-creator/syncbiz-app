import type { ComponentProps, ReactNode } from "react";

/**
 * Presentational shell for unified library list rows (/sources list, etc.).
 * Behavior (play, drag, open) stays in the parent via `rowProps` and slots.
 */
export type LibraryBrowseRowSurfaceProps = {
  /**
   * `library` = /sources list (thumb ring, stacked title/meta, library theme rows).
   * `favorites` = /favorites list (centered transport cluster, slate row chrome).
   */
  variant?: "library" | "favorites";
  active: boolean;
  draggable?: boolean;
  thumbSlot: ReactNode;
  /** e.g. favorite toggle — rendered before the title column */
  leadingSlot?: ReactNode;
  titleSlot: ReactNode;
  /** Secondary line under the title (omit when nothing to show). */
  metaSlot?: ReactNode;
  /** e.g. provider logo to the right of the text column */
  titleAsideSlot?: ReactNode;
  controlsSlot: ReactNode;
  controlsGroupAriaLabel: string;
  /** Extra handlers on the controls strip (e.g. audit logging); click still stops propagation */
  controlsWrapperProps?: Omit<ComponentProps<"div">, "children">;
  /** Root row: draggable, onDragStart, onClick, onDoubleClick, onPointerDownCapture, className, … */
  rowProps?: Omit<ComponentProps<"div">, "children">;
};
