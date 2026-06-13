/**
 * PlaylistPro fixed local roots (main process). Mirror of lib/playlistpro-paths.ts.
 */

export const PLAYLISTPRO_MUSIC_ROOT = "D:\\Playlistpro\\Dropbox\\MUSIC\\MAIN MUSIC";
export const PLAYLISTPRO_METADATA_BANK_ROOT = "D:\\SyncBiz-Local-Metadata\\PLP-Playlist";

function normalizeWinPath(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+$/, "").trim();
}

export function isPlaylistProMusicRoot(path: string | null | undefined): boolean {
  if (!path?.trim()) return false;
  const a = normalizeWinPath(path).toLowerCase();
  const b = normalizeWinPath(PLAYLISTPRO_MUSIC_ROOT).toLowerCase();
  return a === b || a.startsWith(`${b}\\`);
}

export function musicFolderDisplayLabel(path: string | null | undefined): string | null {
  if (!path?.trim()) return null;
  if (isPlaylistProMusicRoot(path)) return "PlaylistPro Library";
  return null;
}
