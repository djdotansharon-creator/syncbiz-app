/**
 * Phase A2 — M3U / local-files PlatformReader adapter (honest boundary).
 *
 * A REAL M3U reader exists, but it lives in the Electron desktop MAIN process
 * (desktop/src/main/import-local-m3u-playlist.ts) which is OUTSIDE the Next.js
 * tsconfig and has filesystem access the web layer does not. This web-side adapter
 * therefore only DETECTS M3U/PLS/local inputs and documents where the real parse
 * happens. It does not fake in-process reading. When the Universal Import screen
 * runs inside desktop, wiring will delegate to desktop-main over IPC.
 */

import type { PlatformDetection, PlatformReader, ReaderCapabilities } from "@/lib/universal/platform-reader";
import type { NormalizedTrack } from "@/lib/universal/universal-track";

const CAPABILITIES: ReaderCapabilities = {
  detect: true,
  readPlaylist: false, // Real parsing runs in desktop-main; the web layer does not read files.
  readAlbum: false,
  readTrack: false,
  nativePlayback: true,
  note: "Detection only in web; real M3U/PLS + local-bank parse lives in Electron desktop-main.",
};

export const m3uLocalReader: PlatformReader = {
  id: "m3u",
  capabilities: CAPABILITIES,

  detect(url: string): PlatformDetection | null {
    const lower = url.toLowerCase();
    const isPlaylistFile = /\.(m3u8?|pls|xspf|wpl)(?:[?#].*)?$/.test(lower);
    const isLocalPath = lower.startsWith("local://") || /^[a-z]:\\/i.test(url) || url.startsWith("file:");
    if (!isPlaylistFile && !isLocalPath) return null;
    return { provider: "generic_music_url", kind: isPlaylistFile ? "playlist" : "track", supported: false };
  },

  normalize(raw: unknown): NormalizedTrack {
    const r = (raw ?? {}) as { title?: string; path?: string };
    return {
      displayTitle: r.title ?? r.path ?? "Local track",
      artists: [],
      providerRef: r.path ? { provider: "local", externalId: r.path } : undefined,
      raw,
    };
  },
};
