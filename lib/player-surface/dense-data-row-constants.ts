/**
 * Legacy `Source` list row (owner SourceLibrary list view):
 * thumb · name/desc · type · target · live · actions
 */
export const DENSE_LEGACY_SOURCE_ROW_GRID_CLASS =
  "grid-cols-[auto,1.5fr,1fr,2fr,0.8fr,auto] gap-3 sm:gap-4 items-center px-3 sm:px-4 py-3 text-sm transition hover:bg-slate-900/40";

/** `/library` list — `LibraryItemRow`: thumb · title/genre · transport + edit/share */
export const DENSE_LIBRARY_ITEM_ROW_GRID_CLASS =
  "grid-cols-[auto,1fr,auto] gap-4 items-center px-4 py-3";

/** `/playlists` list — `PlaylistRow`: thumb · meta · transport · volume/edit/share/delete */
export const DENSE_PLAYLIST_MANAGER_ROW_GRID_CLASS =
  "grid-cols-[auto,1fr,auto] gap-4 items-center px-4 py-4 sm:grid-cols-[auto,1fr,auto,auto]";

/** `/devices` admin table header (includes `grid`) — device · playback · platform health · status */
export const DENSE_ADMIN_DEVICES_TABLE_HEADER_CLASS =
  "grid grid-cols-[1.4fr,1fr,1fr,0.8fr] gap-4 border-b border-slate-800/80 px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-500";

/** `/devices` data rows — same column template as header */
export const DENSE_ADMIN_DEVICES_TABLE_ROW_GRID_CLASS =
  "grid-cols-[1.4fr,1fr,1fr,0.8fr] gap-4 px-4 py-3 text-sm transition hover:bg-slate-900/40";

/** `/announcements` admin table header */
export const DENSE_ADMIN_ANNOUNCEMENTS_TABLE_HEADER_CLASS =
  "grid grid-cols-[1.4fr,1.2fr,0.8fr] gap-4 border-b border-slate-800/80 px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-500";

/** `/announcements` data rows */
export const DENSE_ADMIN_ANNOUNCEMENTS_TABLE_ROW_GRID_CLASS =
  "grid-cols-[1.4fr,1.2fr,0.8fr] gap-4 px-4 py-3 text-sm transition hover:bg-slate-900/40";
