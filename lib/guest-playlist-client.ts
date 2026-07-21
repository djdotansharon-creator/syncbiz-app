"use client";

import { resolveYouTubePlayableUrlForSearch } from "@/lib/search-playlist-client";
import { savePlaylistToLocal } from "@/lib/unified-sources-client";
import { appendSourcesToPlaylistTracks } from "@/lib/playlist-append-sources";
import type { UnifiedSource, ParseUrlJson } from "@/lib/source-types";
import type { Playlist, PlaylistTrack, PlaylistType } from "@/lib/playlist-types";

/**
 * GUESTS ingestion — reuses the EXISTING resolver + playlist mechanism. A guest
 * URL is resolved to a compact card (title/artist/cover) via /api/sources/parse-url,
 * and "Add to GUESTS" appends the resolved source to a per-workspace playlist named
 * "GUESTS" (create-if-missing) through the normal /api/playlists routes. No new DB,
 * no request system. Cross-device refresh happens automatically inside those routes
 * (notifyLibraryUpdated), so CONTROL sees the GUESTS playlist.
 */

export const GUESTS_PLAYLIST_NAME = "GUESTS";

export type GuestCard = {
  rawUrl: string;
  title: string;
  artist: string | null;
  cover: string | null;
  type: string;
};

const isHttp = (s: string) => /^https?:\/\//i.test(s.trim());

/** Resolve a URL to display metadata via the existing parser — NO DB write. */
export async function resolveGuestCard(url: string): Promise<GuestCard | null> {
  const raw = url.trim();
  if (!raw || !isHttp(raw)) return null;
  let res: Response;
  try {
    res = await fetch("/api/sources/parse-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: raw }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const p = (await res.json().catch(() => null)) as ParseUrlJson | null;
  if (!p) return null;
  const title = (p.song ?? p.title ?? "").trim() || "Untitled";
  return {
    rawUrl: raw,
    title,
    artist: (p.artist ?? "").trim() || null,
    cover: p.cover ?? null,
    type: p.type ?? "stream-url",
  };
}

const rid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Build a playable UnifiedSource from a resolved card — IN MEMORY, no DB write.
 * Used for Play-now and as the leaf for Add-to-GUESTS. Deliberately does NOT
 * persist a playlist row (the old createPlaylistFromUrl scaffold showed up under
 * SINGLE TRACKS and triggered a library refresh); only Add-to-GUESTS persists,
 * and only into the GUESTS playlist.
 */
export async function guestCardToSource(card: GuestCard): Promise<UnifiedSource> {
  const playable =
    card.type === "youtube" ? await resolveYouTubePlayableUrlForSearch(card.rawUrl) : card.rawUrl;
  const type = card.type as PlaylistType;
  const trackId = rid("t-guest");
  const track: PlaylistTrack = {
    id: trackId,
    name: card.title,
    type,
    url: playable,
    cover: card.cover ?? undefined,
  };
  const playlist: Playlist = {
    id: rid("guest-pl"),
    name: card.title,
    genre: "Guests",
    type,
    url: playable,
    thumbnail: card.cover ?? "",
    createdAt: new Date().toISOString(),
    tracks: [track],
    order: [trackId],
  };
  return {
    id: `pl-${playlist.id}`,
    title: card.title,
    genre: "Guests",
    cover: card.cover,
    type: card.type as UnifiedSource["type"],
    url: playable,
    origin: "playlist",
    playlist,
  };
}

export type AddToGuestsResult = { ok: boolean; created: boolean; alreadyThere: boolean };

/** Append a resolved source to the workspace "GUESTS" playlist (create-if-missing). */
export async function addSourceToGuestsPlaylist(source: UnifiedSource): Promise<AddToGuestsResult> {
  // Find the existing GUESTS playlist (tenant/branch-scoped list).
  let list: Playlist[] = [];
  try {
    const r = await fetch("/api/playlists");
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j)) list = j as Playlist[];
    }
  } catch {
    /* fall through to create */
  }
  const existing = list.find((p) => (p.name ?? "").trim().toUpperCase() === GUESTS_PLAYLIST_NAME);

  // Create GUESTS with this first track.
  if (!existing) {
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: GUESTS_PLAYLIST_NAME,
        url: source.url,
        type: source.type,
        genre: source.genre || "Guests",
        thumbnail: source.cover ?? "",
      }),
    });
    if (!res.ok) return { ok: false, created: false, alreadyThere: false };
    const created = (await res.json()) as Playlist;
    savePlaylistToLocal(created);
    window.dispatchEvent(new Event("library-updated"));
    return { ok: true, created: true, alreadyThere: false };
  }

  // Append to the existing GUESTS (GET → merge → PUT), the canonical add-to-playlist path.
  let current: Playlist;
  try {
    const g = await fetch(`/api/playlists/${existing.id}`);
    if (!g.ok) return { ok: false, created: false, alreadyThere: false };
    current = (await g.json()) as Playlist;
  } catch {
    return { ok: false, created: false, alreadyThere: false };
  }
  const { tracks, order, addedCount } = appendSourcesToPlaylistTracks(current, [source]);
  if (addedCount === 0) return { ok: true, created: false, alreadyThere: true };
  const put = await fetch(`/api/playlists/${existing.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracks, order }),
  });
  if (!put.ok) return { ok: false, created: false, alreadyThere: false };
  const updated = (await put.json()) as Playlist;
  savePlaylistToLocal(updated);
  window.dispatchEvent(new Event("library-updated"));
  return { ok: true, created: false, alreadyThere: false };
}
