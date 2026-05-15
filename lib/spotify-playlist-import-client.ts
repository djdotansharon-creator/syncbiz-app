/**
 * Spotify playlist / album → M3uUnresolvedImportRow[] adapter for the existing bulk YouTube
 * resolver UI. No audio is uploaded and no Spotify track URL is ever persisted: each Spotify
 * row becomes a search-query "stub", and either:
 *   - (Stage 6D-Auto) `runSpotifyAutoBuildYoutubeSearch` resolves every row to its top valid
 *     YouTube candidate without UI, then `saveAutoBuiltYoutubePlaylist` POSTs a
 *     YouTube-only playlist; missing rows can be opened in the modal for manual review.
 *   - (legacy fallback) the user opens the modal in `create_youtube_only` mode and picks
 *     a candidate per row before saving.
 */

import {
  isSafeAutoPick,
  narrowYoutubeCandidatesForM3uRow,
  scoreYoutubeCandidateForRow,
} from "@/lib/m3u-youtube-bulk-confidence";
import type { M3uYoutubePickForMerge } from "@/lib/m3u-import-youtube-merge";
import type { M3uUnresolvedImportRow } from "@/lib/m3u-youtube-resolve-shared";
import {
  canonicalYouTubeWatchUrlForPlayback,
  getYouTubeThumbnail,
  getYouTubeVideoId,
} from "@/lib/playlist-utils";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import { resolveYouTubePlayableUrlForSearch } from "@/lib/search-playlist-client";
import { searchExternal, type YouTubeSearchResult } from "@/lib/search-service";

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
   * Spotify returned `HTTP 403/404` reading the playlist under Client Credentials —
   * typically a personalized / Made-For-You / private / collaborative playlist. The
   * renderer shows `message` verbatim; `reason` is for analytics / labelling.
   *
   * Stage 6E-A: `connectAvailable === true` → the session user has not connected
   * Spotify (or must reconnect); the renderer shows a "Connect Spotify" CTA next to
   * "Paste tracklist". `false` → the user IS connected but still lacks access to this
   * playlist (connecting again won't help; paste-tracklist remains the fallback).
   * `needsReauth === true` → stored token is revoked/undecryptable; CTA says "Reconnect".
   */
  | {
      status: "playlist_blocked";
      reason: SpotifyPlaylistBlockedReason;
      message: string;
      connectAvailable?: boolean;
      needsReauth?: boolean;
    }
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

/* ---------------------------------------------------------------------------
 * Spotify Auto-Build — Stage 6D-Auto
 *
 * For Spotify album / public-playlist imports we already get a strong tracklist
 * (artist + title + order). Surfacing the big "review every row" picker is too
 * much friction for that signal strength, so this orchestrator resolves every
 * row to its top valid YouTube candidate without UI, then builds a YouTube-only
 * playlist directly. The existing resolver modal is reused as a fallback for
 * rows that didn't get a confident enough YouTube hit (see save mode
 * `append_to_existing_youtube` in `m3u-youtube-resolve-modal.tsx`).
 *
 * Definition of "top valid candidate":
 *   The narrower (`narrowYoutubeCandidatesForM3uRow`) already drops live/remix/
 *   cover/etc. unless justified by the query, and ranks the remaining pool
 *   official-first (Official Video ≥ Official Audio ≥ Topic ≥ VEVO), then by
 *   confidence + views. We pick its slot 0 and gate it on
 *   `scoreYoutubeCandidateForRow(...).tier !== "none"` so weak/garbage rows
 *   fall into `missing` rather than silently saving a wrong match.
 * ------------------------------------------------------------------------- */

/** Sequential progress events fired while the orchestrator runs. */
export type SpotifyAutoBuildProgress =
  | { phase: "searching"; done: number; total: number }
  | { phase: "saving" }
  | { phase: "done"; resolvedCount: number; totalCount: number }
  | { phase: "error"; message: string };

/** One row that successfully resolved to a YouTube candidate. `order` = Spotify `playlistOrder`. */
export type SpotifyAutoBuildResolvedPick = {
  order: number;
  pick: M3uYoutubePickForMerge;
};

export type SpotifyAutoBuildSearchOutcome = {
  /** Sorted ascending by `order` so playlist save preserves the original Spotify order. */
  resolved: SpotifyAutoBuildResolvedPick[];
  /** Rows with no valid YouTube hit. Suitable to feed back into the resolver modal. */
  missing: M3uUnresolvedImportRow[];
};

/**
 * Mirrors the resolver modal's `BULK_SEARCH_CONCURRENCY = 3`. Keeps the search load
 * comparable to "Auto find all" so we don't hit yt-dlp / API rate limits any harder
 * than the existing manual flow.
 */
const SPOTIFY_AUTO_BUILD_CONCURRENCY = 3;

async function autoBuildPickForRow(
  row: M3uUnresolvedImportRow,
): Promise<M3uYoutubePickForMerge | null> {
  const query = row.suggestedSearchQuery.trim();
  if (query.length < 2) return null;

  let youtube: YouTubeSearchResult[];
  try {
    const external = await searchExternal(query);
    youtube = external.youtube.filter(
      (r): r is YouTubeSearchResult & { type: "youtube" } => r.type === "youtube",
    );
  } catch {
    return null;
  }

  const { display } = narrowYoutubeCandidatesForM3uRow(row, youtube);
  if (display.length === 0) return null;
  const best = display[0]!;
  if (!getYouTubeVideoId(best.url)) return null;

  /**
   * Gate on tier so we don't auto-save obviously-wrong matches. `tier === "none"`
   * means the scorer flagged the result as incoherent with the row (weak token
   * overlap or duration far off). We still prefer the narrower's ranking
   * (official-first) for the choice — the tier check only rejects, never picks.
   *
   * Spot-checks where this matters:
   *   - Hebrew/Unicode rows where the only YouTube hit is a duplicate language
   *     "compilation" with no token overlap → none → missing → manual review.
   *   - Generic album titles ("Greatest Hits") where the only hit is a 90-min
   *     full-album upload that violates `\bfull\s+album\b` → none → missing.
   *
   * `isSafeAutoPick` would be stricter (score ≥ 0.78 + margin); we deliberately
   * accept `tier === "review"` here because the Spotify-provided artist+title
   * gives stronger upstream signal than M3U lines and the alternative is
   * forcing the operator into the picker even when the official-flavor result
   * is plainly correct. Anything weaker than that falls into `missing`.
   */
  const score = scoreYoutubeCandidateForRow(row, best, 0);
  if (score.tier === "none") return null;

  /** Tag whether this counted as a high-confidence auto-pick (telemetry-friendly, currently unused). */
  void isSafeAutoPick;

  let watchUrl: string;
  try {
    watchUrl = await resolveYouTubePlayableUrlForSearch(best.url);
  } catch {
    return null;
  }
  if (!getYouTubeVideoId(watchUrl)) return null;

  return {
    url: watchUrl,
    title: best.title.trim() || "YouTube video",
    cover: best.cover,
    durationSeconds: best.durationSeconds,
    viewCount: best.viewCount,
  };
}

/**
 * Run the per-row YouTube search and auto-pick step for every Spotify row.
 * Emits `searching` progress for the operator banner; never throws — any per-row
 * failure is collected as `missing`.
 */
export async function runSpotifyAutoBuildYoutubeSearch(opts: {
  rows: readonly M3uUnresolvedImportRow[];
  onProgress?: (p: SpotifyAutoBuildProgress) => void;
}): Promise<SpotifyAutoBuildSearchOutcome> {
  const ordered = [...opts.rows].sort((a, b) => a.playlistOrder - b.playlistOrder);
  const total = ordered.length;
  const resolved: SpotifyAutoBuildResolvedPick[] = [];
  const missing: M3uUnresolvedImportRow[] = [];
  let done = 0;
  opts.onProgress?.({ phase: "searching", done, total });

  for (let i = 0; i < ordered.length; i += SPOTIFY_AUTO_BUILD_CONCURRENCY) {
    const chunk = ordered.slice(i, i + SPOTIFY_AUTO_BUILD_CONCURRENCY);
    const picks = await Promise.all(chunk.map((row) => autoBuildPickForRow(row)));
    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j]!;
      const pick = picks[j];
      if (pick) resolved.push({ order: row.playlistOrder, pick });
      else missing.push(row);
      done++;
      opts.onProgress?.({ phase: "searching", done, total });
    }
  }

  resolved.sort((a, b) => a.order - b.order);
  return { resolved, missing };
}

/**
 * Convert one auto-build pick into the `PlaylistTrack` shape persisted by
 * `/api/playlists`. Reuses the same normalisation the resolver modal does in
 * its `create_youtube_only` branch so DB rows look identical regardless of
 * which flow created them.
 */
export function autoBuildPickToPlaylistTrack(p: SpotifyAutoBuildResolvedPick): PlaylistTrack {
  const watchUrl = canonicalYouTubeWatchUrlForPlayback(p.pick.url).trim();
  if (!getYouTubeVideoId(watchUrl)) {
    throw new Error("Spotify auto-build: a resolved pick is not a single YouTube video URL.");
  }
  const thumb = (p.pick.cover && p.pick.cover.trim()) || getYouTubeThumbnail(watchUrl);
  return {
    id: crypto.randomUUID(),
    name: p.pick.title.trim() || "YouTube video",
    type: "youtube",
    url: watchUrl,
    cover: thumb || undefined,
    durationSeconds: p.pick.durationSeconds,
    viewCount: p.pick.viewCount,
  };
}

/**
 * POST a YouTube-only playlist made of the resolved Spotify rows, in Spotify order.
 * Throws on HTTP / network failure — caller maps to inline error.
 */
export async function saveAutoBuiltYoutubePlaylist(opts: {
  playlistName: string;
  defaultGenre: string;
  resolved: readonly SpotifyAutoBuildResolvedPick[];
}): Promise<Playlist> {
  if (opts.resolved.length === 0) {
    throw new Error("Spotify auto-build: no resolved tracks to save.");
  }
  const tracks = opts.resolved.map((r) => autoBuildPickToPlaylistTrack(r));
  const firstUrl = tracks[0]!.url;
  const firstCover = tracks[0]?.cover ?? "";
  const res = await fetch("/api/playlists", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: opts.playlistName,
      url: firstUrl,
      genre: opts.defaultGenre,
      type: "youtube",
      thumbnail: firstCover,
      tracks,
    }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg =
      typeof (errBody as { error?: string }).error === "string"
        ? (errBody as { error: string }).error
        : "Could not save playlist.";
    throw new Error(msg);
  }
  return (await res.json()) as Playlist;
}
