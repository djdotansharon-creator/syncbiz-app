"use client";

import type { DenseDataRowSurfaceProps } from "@/lib/player-surface/dense-data-row-types";

/**
 * Presentational shell for dense, column-aligned list rows (data/table geometry).
 * Callers own cell content and behaviors (play, delete, etc.).
 */
export function DenseDataRowSurface({
  gridClassName,
  className = "",
  rowProps,
  cells,
}: DenseDataRowSurfaceProps) {
  const { className: rowClassName, ...restRow } = rowProps ?? {};
  const rootClass = ["grid", gridClassName, className, rowClassName].filter(Boolean).join(" ");

  return (
    <div {...restRow} className={rootClass}>
      {cells}
    </div>
  );
}
