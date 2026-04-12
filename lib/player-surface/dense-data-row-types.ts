import type { ComponentProps, ReactElement } from "react";

/**
 * Tabular / “dense data” list rows: fixed CSS grid tracks (thumb + N columns),
 * unlike `LibraryBrowseRowSurface` (browse: thumb + text block + action strip).
 */
export type DenseDataRowSurfaceProps = {
  /**
   * Grid track definition and row padding (include `grid-cols-[...]`, gaps, alignment, hover).
   * Example: `grid-cols-[auto,1.5fr,1fr,2fr,0.8fr,auto] gap-3 …`
   */
  gridClassName: string;
  className?: string;
  rowProps?: Omit<ComponentProps<"div">, "children">;
  /**
   * One direct grid child per column — must match `gridClassName` column count.
   */
  cells: readonly ReactElement[];
};
