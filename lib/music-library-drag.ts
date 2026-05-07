import { buildEphemeralLocalQueueFromPaths } from "@/lib/ephemeral-local-music-playback";
import { createPlayNextLocalSource } from "@/lib/play-next";
import type { UnifiedSource } from "@/lib/source-types";

/** Drag payload from My Music Library panel → player deck (Electron). */
export const SYNCBIZ_MUSIC_LIBRARY_DRAG_MIME = "application/x-syncbiz-music-library";

export type MusicLibraryDragPayload = {
  kind: "folder" | "file";
  /** Native absolute path */
  path: string;
};

export function setMusicLibraryDragData(dt: DataTransfer, payload: MusicLibraryDragPayload): void {
  dt.setData(SYNCBIZ_MUSIC_LIBRARY_DRAG_MIME, JSON.stringify(payload));
  dt.effectAllowed = "copy";
}

/**
 * Resolves Custom My Music drag data to ephemeral `UnifiedSource` rows.
 * Folder: desktop scan → one ephemeral source per audio file.
 * Never POSTs playlists or touches library persistence.
 */
export async function resolveMyMusicLibraryDropFromDataTransfer(
  dt: DataTransfer | null,
): Promise<UnifiedSource[]> {
  if (!dt) return [];
  const raw = dt.getData(SYNCBIZ_MUSIC_LIBRARY_DRAG_MIME);
  if (!raw?.trim()) return [];
  try {
    const payload = JSON.parse(raw) as MusicLibraryDragPayload;
    const p = payload.path?.trim();
    if (!p || (payload.kind !== "folder" && payload.kind !== "file")) return [];
    const api = typeof window !== "undefined" ? window.syncbizDesktop : undefined;
    if (payload.kind === "file") {
      return [createPlayNextLocalSource(p)];
    }
    if (payload.kind === "folder" && api?.scanLocalAudioFolder) {
      const scan = await api.scanLocalAudioFolder(p);
      if (scan.status === "ok" && scan.files.length > 0) {
        return buildEphemeralLocalQueueFromPaths(scan.files);
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}
