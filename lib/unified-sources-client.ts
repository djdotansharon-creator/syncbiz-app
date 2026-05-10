/**
 * Client-side fetch for unified sources with localStorage fallback.
 * Merges API response with local cache when API returns empty (Railway).
 */

import { radioToUnified } from "./radio-utils";
import { getPlaylistsLocal, addPlaylistLocal, removePlaylistLocal } from "./playlists-local-store";
import { getRadioStationsLocal, addRadioStationLocal, removeRadioStationLocal } from "./radio-local-store";
import type { UnifiedSource, SourceProviderType } from "./source-types";
import type { Playlist } from "./playlist-types";
import { derivePlaylistUnifiedCoverArt, unifiedPlaylistSourceId } from "./playlist-utils";
import type { ApiContentScope } from "./content-scope-filters";
import {
  LOCAL_PLAYLIST_ARTWORK_PLACEHOLDER,
  MAX_EPHEMERAL_TRACK_COVERS_ON_DROP,
  MAX_SAVED_LOCAL_PLAYLIST_TRACK_COVERS,
  embedLocalTrackCoversUpToCap,
  pickFirstEmbeddedLocalCover,
} from "./local-playlist-artwork";

function playlistToUnified(p: Playlist): UnifiedSource {
  const cover = derivePlaylistUnifiedCoverArt(p);
  return {
    id: unifiedPlaylistSourceId(p.id),
    title: p.name,
    genre: p.genre || "Mixed",
    cover,
    type: (p.type ?? "stream-url") as SourceProviderType,
    url: p.url,
    origin: "playlist",
    playlist: p,
    ...(p.libraryPlacement === "ready_external"
      ? { contentNodeKind: "external_playlist" as const }
      : {}),
  };
}

function filterUnifiedSourcesByScope(items: UnifiedSource[], scope: ApiContentScope): UnifiedSource[] {
  return items.filter((s) => {
    if (scope === "branch") {
      if (s.origin === "playlist" && s.playlist) {
        return (s.playlist.playlistOwnershipScope ?? "branch") !== "owner_personal";
      }
      return true;
    }
    if (s.origin === "playlist" && s.playlist) {
      return s.playlist.playlistOwnershipScope === "owner_personal";
    }
    return false;
  });
}

export type FetchUnifiedOptions = {
  /** Default `branch` — branch station + shared catalog. `owner_personal` = OWNER-only bank. */
  scope?: ApiContentScope;
};

export async function fetchUnifiedSourcesWithFallback(options?: FetchUnifiedOptions): Promise<UnifiedSource[]> {
  const scope = options?.scope ?? "branch";
  const qs = scope === "owner_personal" ? "?scope=owner_personal" : "";
  try {
    const res = await fetch(`/api/sources/unified${qs}`, { cache: "no-store", credentials: "include" });
    if (!res.ok) throw new Error("API error");
    const items = (await res.json()) as UnifiedSource[];
    if (!Array.isArray(items)) throw new Error("Invalid response");

    const playlists = items.filter((s) => s.origin === "playlist");
    const radio = items.filter((s) => s.origin === "radio");
    const others = items.filter((s) => s.origin !== "playlist" && s.origin !== "radio");

    if (playlists.length > 0) {
      playlists.forEach((s) => s.playlist && addPlaylistLocal(s.playlist));
    }
    if (radio.length > 0) {
      radio.forEach((s) => s.radio && addRadioStationLocal(s.radio));
    }
    // Important: if API succeeds (even with empty list), trust tenant-scoped server result.
    return dedupeById(await enrichDesktopLocalPlaylistCovers(items));
  } catch {
    const localPlaylists = getPlaylistsLocal().map(playlistToUnified);
    const localRadio = getRadioStationsLocal().map(radioToUnified);
    const merged = dedupeById([...localPlaylists, ...localRadio]);
    return dedupeById(await enrichDesktopLocalPlaylistCovers(filterUnifiedSourcesByScope(merged, scope)));
  }
}

function dedupeById(items: UnifiedSource[]): UnifiedSource[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

async function enrichDesktopLocalPlaylistCovers(items: UnifiedSource[]): Promise<UnifiedSource[]> {
  if (typeof window === "undefined") return items;
  const api = window.syncbizDesktop;
  if (!api) return items;
  const scanFolder = api.scanLocalAudioFolder;
  const getCover = api.getLocalAudioCover;
  if (!getCover) return items;

  return Promise.all(
    items.map(async (s) => {
      // Folder-scan source row (origin=source, type=local_playlist): scan the root and probe.
      if (s.origin === "source") {
        const src = s.source;
        if (!src || src.type !== "local_playlist") return s;
        if (s.cover && `${s.cover}`.trim()) return s;
        if (!scanFolder) return { ...s, cover: LOCAL_PLAYLIST_ARTWORK_PLACEHOLDER };
        const root = (s.url ?? "").trim();
        if (!root) return { ...s, cover: LOCAL_PLAYLIST_ARTWORK_PLACEHOLDER };
        let files: string[] = [];
        try {
          const scan = await scanFolder(root);
          if (scan.status === "ok") files = scan.files;
        } catch {
          /* ignore */
        }
        const embedded = await pickFirstEmbeddedLocalCover((fp) => getCover(fp), files, 8);
        const cover = embedded ?? LOCAL_PLAYLIST_ARTWORK_PLACEHOLDER;
        return { ...s, cover };
      }

      // Saved local playlist (`POST /api/playlists`): fill per-track embedded art on the
      // embedded `playlist.tracks` rows so expanded leaf tiles + now-playing hero differ per file.
      if (s.origin === "playlist" && s.type === "local" && s.playlist?.tracks && s.playlist.tracks.length > 0) {
        let tracks = s.playlist.tracks.map((t) => ({ ...t }));
        const cap = Math.min(tracks.length, MAX_SAVED_LOCAL_PLAYLIST_TRACK_COVERS);
        for (let i = 0; i < cap; i++) {
          const t = tracks[i]!;
          if ((t.type ?? "local") !== "local") continue;
          const path = (t.url ?? "").trim();
          if (!path || `${t.cover ?? ""}`.trim()) continue;
          try {
            const cov = await getCover(path);
            if (cov.status === "ok" && cov.dataUrl?.trim()) {
              tracks[i] = { ...t, cover: cov.dataUrl.trim() };
            }
          } catch {
            /* ignore */
          }
        }
        const playlist = { ...s.playlist, tracks };
        const derivedShell = derivePlaylistUnifiedCoverArt(playlist);
        const shellCover = (`${s.cover ?? ""}`.trim() || derivedShell || LOCAL_PLAYLIST_ARTWORK_PLACEHOLDER).trim();
        const thumb = `${playlist.thumbnail ?? ""}`.trim() || shellCover;
        return {
          ...s,
          cover: shellCover || s.cover,
          playlist: {
            ...playlist,
            ...(thumb ? { thumbnail: thumb } : {}),
            ...(!`${playlist.cover ?? ""}`.trim() && thumb ? { cover: thumb } : {}),
          },
        };
      }

      return s;
    }),
  );
}

export function savePlaylistToLocal(playlist: Playlist): void {
  addPlaylistLocal(playlist);
}

export function saveRadioToLocal(station: import("./source-types").RadioStream): void {
  addRadioStationLocal(station);
}

export function removePlaylistFromLocal(id: string): void {
  removePlaylistLocal(id.replace(/^pl-/, ""));
}

export function removeRadioFromLocal(id: string): void {
  removeRadioStationLocal(id);
}
