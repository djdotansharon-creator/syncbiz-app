/**
 * Client-side fetch for unified sources with localStorage fallback.
 * Merges API response with local cache when API returns empty (Railway).
 */

import { radioToUnified } from "./radio-utils";
import { getPlaylistsLocal, addPlaylistLocal, removePlaylistLocal } from "./playlists-local-store";
import { getRadioStationsLocal, addRadioStationLocal, removeRadioStationLocal } from "./radio-local-store";
import type { UnifiedSource, SourceProviderType } from "./source-types";
import type { Playlist } from "./playlist-types";

function playlistToUnified(p: Playlist): UnifiedSource {
  const cover = p.thumbnail || p.cover || null;
  return {
    id: `pl-${p.id}`,
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

export async function fetchUnifiedSourcesWithFallback(): Promise<UnifiedSource[]> {
  try {
    const res = await fetch("/api/sources/unified", { cache: "no-store", credentials: "include" });
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
    return dedupeById(items);
  } catch {
    const localPlaylists = getPlaylistsLocal().map(playlistToUnified);
    const localRadio = getRadioStationsLocal().map(radioToUnified);
    return dedupeById([...localPlaylists, ...localRadio]);
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
