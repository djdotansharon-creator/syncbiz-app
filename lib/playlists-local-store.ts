/**
 * Client-side localStorage cache for playlists.
 * Used as fallback when API returns empty (e.g. Railway ephemeral fs).
 * SSR-safe: returns [] when window is undefined.
 */

import type { Playlist } from "./playlist-types";

const STORAGE_KEY = "syncbiz-playlists-local";

export function getPlaylistsLocal(): Playlist[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((p): p is Playlist => p && typeof p === "object" && typeof (p as Playlist).id === "string" && typeof (p as Playlist).name === "string") : [];
  } catch {
    return [];
  }
}

export function setPlaylistsLocal(playlists: Playlist[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
  } catch {
    /* ignore */
  }
}

export function addPlaylistLocal(playlist: Playlist): void {
  const list = getPlaylistsLocal();
  if (list.some((p) => p.id === playlist.id)) return;
  setPlaylistsLocal([playlist, ...list]);
}

export function removePlaylistLocal(id: string): void {
  setPlaylistsLocal(getPlaylistsLocal().filter((p) => p.id !== id));
}
