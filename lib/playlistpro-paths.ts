/**
 * PlaylistPro fixed local roots (professional music bank on drive D).
 * Paths are resolved only inside SyncBiz Desktop — never shown to normal users.
 */

export const PLAYLISTPRO_MUSIC_ROOT = "D:\\Playlistpro\\Dropbox\\MUSIC\\MAIN MUSIC";
export const PLAYLISTPRO_METADATA_BANK_ROOT = "D:\\SyncBiz-Local-Metadata\\PLP-Playlist";
export const PLAYLISTPRO_LIBRARY_DISPLAY_NAME = "PlaylistPro Library";

function normalizeWinPath(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+$/, "").trim();
}

export function isPlaylistProMusicRoot(path: string | null | undefined): boolean {
  if (!path?.trim()) return false;
  const a = normalizeWinPath(path).toLowerCase();
  const b = normalizeWinPath(PLAYLISTPRO_MUSIC_ROOT).toLowerCase();
  return a === b || a.startsWith(`${b}\\`);
}

export function isPlaylistProMetadataBank(path: string | null | undefined): boolean {
  if (!path?.trim()) return false;
  const a = normalizeWinPath(path).toLowerCase();
  const b = normalizeWinPath(PLAYLISTPRO_METADATA_BANK_ROOT).toLowerCase();
  return a === b || a.startsWith(`${b}\\`);
}

/** Redact absolute paths for normal UI (settings, breadcrumbs). */
export function redactPathForUserDisplay(
  path: string | null | undefined,
  opts?: { isOperator?: boolean },
): string {
  if (!path?.trim()) return "";
  if (opts?.isOperator) return path;
  if (isPlaylistProMusicRoot(path)) return PLAYLISTPRO_LIBRARY_DISPLAY_NAME;
  if (isPlaylistProMetadataBank(path)) return "PlaylistPro metadata (local)";
  const name = path.replace(/^.*[\\/]/, "").trim();
  return name || PLAYLISTPRO_LIBRARY_DISPLAY_NAME;
}

export function formatMusicLibraryBreadcrumbRoot(
  rootPath: string | null | undefined,
  opts?: { isOperator?: boolean },
): string {
  if (!rootPath?.trim()) return PLAYLISTPRO_LIBRARY_DISPLAY_NAME;
  if (opts?.isOperator && !isPlaylistProMusicRoot(rootPath)) {
    const name = rootPath.replace(/^.*[\\/]/, "").trim();
    return name || PLAYLISTPRO_LIBRARY_DISPLAY_NAME;
  }
  return PLAYLISTPRO_LIBRARY_DISPLAY_NAME;
}

export function formatMusicLibraryLocationTitle(
  rootPath: string | null | undefined,
  relSubpath: string,
  opts?: { isOperator?: boolean },
): string | undefined {
  if (!opts?.isOperator) return undefined;
  if (!rootPath?.trim()) return undefined;
  const sep = rootPath.includes("\\") ? "\\" : "/";
  const rel = relSubpath ? relSubpath.replace(/\//g, sep) : "";
  return rel ? `${rootPath}${sep}${rel}` : rootPath;
}
