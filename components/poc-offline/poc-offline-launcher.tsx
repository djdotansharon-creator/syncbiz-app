"use client";

/**
 * POC-ONLY offline launcher (Stage 2b) — dev/desktop-gated, isolated, additive.
 *
 * Flow: manifest → window.syncbizDesktop.getOfflinePocPlaylist() → ephemeral local Playlist
 *       → RAW playSource (NOT useRoutedPlaySource) → existing Audio Player → mpvPlayUrl → MPV.
 *
 * It ONLY registers a manual trigger (window.__syncbizPocPlayOffline) when running inside the
 * Electron desktop (window.syncbizDesktop present). It renders nothing, auto-plays nothing, and
 * touches no player/WS/orchestrator code. Feature-detected: if the desktop bridge lacks
 * getOfflinePocPlaylist, it reports "unavailable" and does nothing (no crash, no fallback, no
 * Asset-ID playback). Legacy shells are unaffected.
 */

import { useEffect } from "react";
import { usePlayback } from "@/lib/playback-provider";
import { EPHEMERAL_LOCAL_PLAYLIST_PREFIX } from "@/lib/local-playlist-artwork";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";

type OfflinePocResult = {
  available: boolean;
  title?: string;
  tracks?: { id: string; name: string; url: string }[];
  reason?: string;
};

export function PocOfflineLauncher(): null {
  const { playSource } = usePlayback(); // RAW playSource — desktop-local, never routed over WS.

  useEffect(() => {
    if (typeof window === "undefined") return;
    const desktop = (window as unknown as { syncbizDesktop?: { getOfflinePocPlaylist?: () => Promise<OfflinePocResult> } }).syncbizDesktop;
    if (!desktop) return; // desktop-only: do not register in browser/mobile.

    const trigger = async () => {
      if (typeof desktop.getOfflinePocPlaylist !== "function") {
        console.warn("[POC offline] feature unavailable — desktop bridge getOfflinePocPlaylist not present");
        return { ok: false, reason: "feature-unavailable" };
      }
      let res: OfflinePocResult;
      try {
        res = await desktop.getOfflinePocPlaylist();
      } catch (e) {
        console.warn("[POC offline] bridge error:", e instanceof Error ? e.message : String(e));
        return { ok: false, reason: "bridge-error" };
      }
      if (!res?.available || !res.tracks?.length) {
        console.warn("[POC offline] not available:", res?.reason ?? "unknown");
        return { ok: false, reason: res?.reason ?? "unavailable" };
      }
      // Build an ephemeral local Playlist FROM THE MANIFEST (names/ids/absolute paths).
      const tracks: PlaylistTrack[] = res.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        type: "local" as const,
        url: t.url, // absolute local filesystem path — mpv-input-normalize converts to file:// on desktop
      }));
      const first = tracks[0].url;
      const playlist: Playlist = {
        id: `${EPHEMERAL_LOCAL_PLAYLIST_PREFIX}poc-samples`, // prefix → playSource skips /api/playlists hydration
        name: res.title ?? "Offline POC",
        genre: "Mixed",
        type: "local",
        url: first,
        thumbnail: "",
        createdAt: new Date().toISOString(),
        tracks,
        order: tracks.map((t) => t.id),
      };
      const source: UnifiedSource = {
        id: playlist.id,
        title: playlist.name,
        genre: "Mixed",
        cover: null,
        type: "local",
        url: first,
        origin: "playlist",
        playlist,
      };
      playSource(source, 0);
      console.log("[POC offline] playing " + tracks.length + " local tracks via the existing chain (playSource)");
      return { ok: true, count: tracks.length };
    };

    (window as unknown as { __syncbizPocPlayOffline?: () => Promise<unknown> }).__syncbizPocPlayOffline = trigger;
    console.log("[POC offline] launcher ready — run  __syncbizPocPlayOffline()  in the Desktop DevTools console to play the offline playlist");
    return () => {
      try { delete (window as unknown as { __syncbizPocPlayOffline?: unknown }).__syncbizPocPlayOffline; } catch { /* ignore */ }
    };
  }, [playSource]);

  return null;
}
