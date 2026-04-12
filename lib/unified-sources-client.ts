/**
 * Client-side fetch for unified sources with localStorage fallback.
 * Merges API response with local cache when API returns empty (Railway).
 */

import { radioToUnified } from "./radio-utils";
import { getPlaylistsLocal, addPlaylistLocal, removePlaylistLocal } from "./playlists-local-store";
import { getRadioStationsLocal, addRadioStationLocal, removeRadioStationLocal } from "./radio-local-store";
import type { UnifiedSource, SourceProviderType } from "./source-types";
import type { Playlist } from "./playlist-types";
import { unifiedPlaylistSourceId } from "./playlist-utils";
import type { ApiContentScope } from "./content-scope-filters";

function playlistToUnified(p: Playlist): UnifiedSource {
  const cover = p.thumbnail || p.cover || null;
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
    return dedupeById(items);
  } catch {
    const localPlaylists = getPlaylistsLocal().map(playlistToUnified);
    const localRadio = getRadioStationsLocal().map(radioToUnified);
    const merged = dedupeById([...localPlaylists, ...localRadio]);
    return filterUnifiedSourcesByScope(merged, scope);
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
