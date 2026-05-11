/**
 * Spotify playlist / album → M3uUnresolvedImportRow[] adapter for the existing bulk YouTube
 * resolver UI. No audio is uploaded and no Spotify track URL is ever persisted: each Spotify
 * row becomes a search-query "stub", the user picks a YouTube candidate per row, and the
 * modal saves a YouTube-only playlist via `create_youtube_only` mode.
 */

import type { M3uUnresolvedImportRow } from "@/lib/m3u-youtube-resolve-shared";

/**
 * Mirrors the server route's parser (`app/api/sources/spotify-playlist-preview/route.ts`).
 * Accepts every locale variant Spotify ships: `intl-en`, `intl-iw`, `intl-pt-br`,
 * `intl-zh-tw`, etc. Share-link tracking ids (`?si=…`) sit in `URL.search` and never
 * enter `pathname`, so they're dropped automatically before the regex runs.
 */
const SPOTIFY_PATH_RE = /^\/(?:intl-[a-z][a-z0-9-]{1,9}\/)?(playlist|album)\/([^/?#]+)/i;

/**
 * Spotify URI scheme — `spotify:album:<id>` / `spotify:playlist:<id>`. Spotify Desktop
 * drops this format on drag operations in `text/uri-list` (the HTTPS share link only
 * appears in `text/plain`), and `extractIngestFromDrop` prefers `text/uri-list`. Accept
 * the URI scheme directly so the rest of the pipeline doesn't need separate branches.
 */
const SPOTIFY_URI_RE = /^spotify:(playlist|album):([A-Za-z0-9]+)\b/i;

/**
 * Convert any Spotify share input to the canonical HTTPS form a `new URL(...)` parser
 * accepts. Idempotent — pass-through for inputs that are already canonical HTTPS URLs
 * or for non-Spotify strings.
 */
export function normalizeSpotifyShareInput(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return s;
  const m = s.match(SPOTIFY_URI_RE);
  if (m) return `https://open.spotify.com/${m[1].toLowerCase()}/${m[2]}`;
  return s;
}

/** Mirrors the server-side route's URL parser so we don't round-trip a non-Spotify URL. */
export function parseSpotifyPlaylistOrAlbumUrl(url: string): { kind: "playlist" | "album"; id: string } | null {
  const candidate = normalizeSpotifyShareInput(url);
  try {
    const u = new URL(candidate);
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    if (h !== "open.spotify.com" && h !== "spotify.com") return null;
    const m = u.pathname.match(SPOTIFY_PATH_RE);
    if (!m) return null;
    const id = (m[2] ?? "").trim();
    if (!id) return null;
    return { kind: m[1].toLowerCase() as "playlist" | "album", id };
  } catch {
    return null;
  }
}

export type SpotifyPlaylistPreviewTrack = {
  playlistOrder: number;
  artist: string;
  title: string;
  durationMs: number;
};

export type SpotifyPlaylistBlockedReason = "personalized" | "private_or_blocked";

export type SpotifyPlaylistPreviewClientResult =
  | {
      status: "ok";
      kind: "playlist" | "album";
      name: string;
      ownerName?: string;
      totalTracks: number;
      tracks: SpotifyPlaylistPreviewTrack[];
    }
  | { status: "not_configured" }
  /**
   * Spotify returned `HTTP 403` reading the playlist under Client Credentials —
   * typically a personalized / Made-For-You / private / collaborative playlist that
   * needs per-operator OAuth (see Stage 6D-B note in the route file). The renderer
   * shows `message` verbatim; `reason` is for analytics / future labelling only.
   */
  | { status: "playlist_blocked"; reason: SpotifyPlaylistBlockedReason; message: string }
  | { status: "error"; message: string };

export async function fetchSpotifyPlaylistPreview(url: string): Promise<SpotifyPlaylistPreviewClientResult> {
  try {
    const res = await fetch("/api/sources/spotify-playlist-preview", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    /** Server uses HTTP 503 for the "not_configured" body so caching layers can flag it. */
    if (res.status === 503) {
      let body: SpotifyPlaylistPreviewClientResult | null = null;
      try {
        body = (await res.json()) as SpotifyPlaylistPreviewClientResult;
      } catch {
        body = null;
      }
      if (body?.status === "not_configured") return body;
      return { status: "not_configured" };
    }
    if (!res.ok) {
      let body: { message?: string } | null = null;
      try {
        body = (await res.json()) as { message?: string };
      } catch {
        body = null;
      }
      return { status: "error", message: body?.message?.trim() || `Spotify preview failed (HTTP ${res.status}).` };
    }
    const data = (await res.json()) as SpotifyPlaylistPreviewClientResult;
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error contacting Spotify preview.";
    return { status: "error", message: msg };
  }
}

/**
 * Map one Spotify track row to the M3U-resolver row shape.
 * The search query is `"<artist> <title>"`; if the artist is unknown we use just the title.
 * `displayTitle` is what the modal renders as the row's primary label.
 */
export function spotifyTrackToUnresolvedRow(t: SpotifyPlaylistPreviewTrack): M3uUnresolvedImportRow {
  const artist = t.artist.trim();
  const title = t.title.trim();
  const search = (artist ? `${artist} ${title}` : title).replace(/\s+/g, " ").trim();
  const display = artist ? `${artist} — ${title}` : title;
  const dur = Number.isFinite(t.durationMs) && t.durationMs > 0 ? Math.round(t.durationMs / 1000) : null;
  return {
    ref: display.slice(0, 256),
    reason: "spotify_track",
    playlistOrder: t.playlistOrder,
    displayTitle: display,
    durationSec: dur,
    suggestedSearchQuery: search,
  };
}

export function spotifyTracksToUnresolvedRows(tracks: SpotifyPlaylistPreviewTrack[]): M3uUnresolvedImportRow[] {
  return tracks.map((t) => spotifyTrackToUnresolvedRow(t));
}
