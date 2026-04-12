"use client";

import type { MouseEvent } from "react";
import type { LibraryBrowseRowSurfaceProps } from "@/lib/player-surface/library-browse-row-types";

const LIBRARY_ROOT_BASE =
  "group/row flex items-start gap-4 px-4 py-3.5 transition-[background,box-shadow] duration-200 ease-out";

export function LibraryBrowseRowSurface({
  variant = "library",
  active,
  draggable,
  thumbSlot,
  leadingSlot,
  titleSlot,
  metaSlot,
  titleAsideSlot,
  controlsSlot,
  controlsGroupAriaLabel,
  controlsWrapperProps,
  rowProps,
}: LibraryBrowseRowSurfaceProps) {
  const { className: rowClassName, ...restRow } = rowProps ?? {};
  const dragCls = draggable ? "cursor-grab active:cursor-grabbing" : "";

  const {
    className: cwClass,
    onClick: cwOnClick,
    ...restControls
  } = controlsWrapperProps ?? {};

  const controlsOnClick = (e: MouseEvent<HTMLDivElement>) => {
    cwOnClick?.(e);
    e.stopPropagation();
  };

  if (variant === "favorites") {
    const favRoot = [
      "flex items-center gap-4 rounded-xl px-4 py-3 transition-all",
      active ? "playing-active bg-slate-900/60" : "hover:bg-slate-900/40",
      dragCls,
      rowClassName,
    ]
      .filter(Boolean)
      .join(" ");

    const thumbWrap = "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-800";
    const controlsStripClass = ["flex flex-nowrap items-center gap-2 shrink-0", cwClass].filter(Boolean).join(" ");

    return (
      <div {...restRow} className={favRoot}>
        <div className={thumbWrap}>{thumbSlot}</div>
        <div className="min-w-0 flex-1 flex items-center gap-3">
          {leadingSlot}
          {titleSlot}
          {metaSlot ?? null}
        </div>
        <div className="flex-1 min-w-0" aria-hidden />
        <div
          className={controlsStripClass}
          role="group"
          aria-label={controlsGroupAriaLabel}
          draggable={false}
          onClick={controlsOnClick}
          {...restControls}
        >
          {controlsSlot}
        </div>
        <div className="flex-1 min-w-0" aria-hidden />
      </div>
    );
  }

  const activeCls = active ? "library-playing-row library-row-active-bg" : "library-row-hover";
  const rootClass = [LIBRARY_ROOT_BASE, activeCls, dragCls, rowClassName].filter(Boolean).join(" ");

  return (
    <div {...restRow} className={rootClass}>
      <div className="library-thumb-frame relative h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-[color:var(--lib-border-thumb)]">
        {thumbSlot}
      </div>
      <div className="min-w-0 flex-1 flex items-start gap-3">
        {leadingSlot}
        <div className="min-w-0 flex flex-col gap-0.5 pr-2">
          {titleSlot}
          {metaSlot ?? null}
        </div>
        {titleAsideSlot}
      </div>
      <div
        className={["library-row-controls ml-2 flex flex-nowrap items-center gap-2 shrink-0", cwClass].filter(Boolean).join(" ")}
        role="group"
        aria-label={controlsGroupAriaLabel}
        draggable={false}
        onClick={controlsOnClick}
        {...restControls}
      >
        {controlsSlot}
      </div>
    </div>
  );
}
