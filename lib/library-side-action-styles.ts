/** Borderless white side actions (library rail, playlist tiles, etc.). */
export const LIBRARY_SIDE_ACTION_ICON_BTN_CLASS =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-white shadow-none outline-none ring-0 transition-colors hover:bg-white/10 active:bg-white/[0.14] focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-0";

/** Tight group for clock + trash on scheduled playlist tiles (left rail). */
export const LIBRARY_PLAYLIST_TILE_SIDE_ACTION_CLUSTER_CLASS =
  "flex shrink-0 items-center gap-px";

/**
 * Softer, lighter chrome than {@link LIBRARY_SIDE_ACTION_ICON_BTN_CLASS} — compact cluster,
 * minimal hover fill, same white icon language (scheduled tiles only).
 */
export const LIBRARY_PLAYLIST_TILE_SIDE_ACTION_BTN_CLASS =
  "inline-flex h-8 w-8 min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-white shadow-none outline-none ring-0 transition-[background-color] duration-150 ease-out hover:bg-white/[0.05] active:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-white/22 focus-visible:ring-offset-0";
