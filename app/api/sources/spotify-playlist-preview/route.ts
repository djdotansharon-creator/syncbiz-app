/**
 * Spotify playlist / album preview — fetches the track list via the client-credentials
 * Web API flow so the renderer can feed each row into the existing M3U YouTube resolver UI.
 *
 * No audio is uploaded, no Spotify track URLs are persisted: this route only returns
 * `{ artist, title, durationMs, playlistOrder }` so the renderer can build YouTube search
 * queries and let the user pick official-first candidates. Persistence is YouTube-only
 * (see the `create_youtube_only` branch of `M3uYoutubeResolveModal`).
 *
 * Env (required):
 *   SPOTIFY_CLIENT_ID
 *   SPOTIFY_CLIENT_SECRET
 *
 * When either is missing → `{ status: "not_configured" }` (HTTP 503). The renderer surfaces
 * the literal string "Spotify import is not configured." in that case.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Stage 6D-A scope (current):
 *   - Album import via Client Credentials ............................. supported
 *   - Public editorial playlist import via Client Credentials ......... supported
 *   - Personalized / Made-For-You / Daily Mix / private playlists ..... NOT supported
 *
 * Spotify gates personalized playlists (Daily Mix, Discover Weekly, Release Radar, every
 * "Made for <user>" playlist) and any private/collaborative playlist behind a user-scoped
 * OAuth token. The Client-Credentials grant is application-scoped and Spotify rejects
 * those reads with `HTTP 403` — and, observed in the wild for Daily Mix / Made-For-You ids
 * with the `37i9dQZF1E` prefix, sometimes `HTTP 404`. We treat both statuses as
 * `playlist_blocked` when the id matches that personalized prefix. We DO NOT scrape
 * Spotify's web UI, download Spotify audio, or try to bypass that ACL. Instead we
 * surface a clear inline message and point the operator at album import. See Stage 6D-B
 * note below.
 *
 * Stage 6D-B (future, not in this stage):
 *   Connect Spotify account with OAuth (Authorization Code + PKCE) so the renderer can
 *   exchange a per-operator user token for `/v1/me/playlists`, `/v1/users/{id}/playlists`,
 *   and the gated personalized playlists. Persistence stays YouTube-only: the OAuth flow
 *   only widens which playlists we can READ for query-building; tracks still resolve
 *   through the existing M3U YouTube resolver UI and save through `create_youtube_only`.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";

/** Pinned to Node — `Buffer` + outbound `fetch` to api.spotify.com need server runtime. */
export const runtime = "nodejs";

/** Defensive cap so a runaway public playlist can't trigger thousands of upstream calls. */
const MAX_TRACKS_RETURNED = 500;
const PLAYLIST_PAGE_SIZE = 100;
const ALBUM_PAGE_SIZE = 50;

type SpotifyPreviewTrack = {
  playlistOrder: number;
  artist: string;
  title: string;
  durationMs: number;
};

export type SpotifyPlaylistBlockedReason = "personalized" | "private_or_blocked";

export type SpotifyPlaylistPreviewResult =
  | {
      status: "ok";
      kind: "playlist" | "album";
      name: string;
      ownerName?: string;
      totalTracks: number;
      tracks: SpotifyPreviewTrack[];
    }
  | { status: "not_configured" }
  | {
      /**
       * Spotify returned HTTP 403 reading a playlist via Client Credentials. The most common
       * cause is a personalized / Made-For-You / private / collaborative playlist that
       * requires per-operator OAuth (see Stage 6D-B note at the top of this file).
       */
      status: "playlist_blocked";
      reason: SpotifyPlaylistBlockedReason;
      message: string;
    }
  | { status: "error"; message: string };

/**
 * Tagged error thrown deep inside `fetchPlaylistPreview` when Spotify rejects a playlist
 * read with `HTTP 403` (or `HTTP 404` for personalized `37i9dQZF1E*` ids) under the
 * Client-Credentials grant. The POST handler unwraps it into a structured
 * `playlist_blocked` response — the renderer matches on status to show the exact required
 * inline error string instead of a generic "Spotify request failed".
 */
class SpotifyPlaylistBlockedError extends Error {
  reason: SpotifyPlaylistBlockedReason;
  constructor(reason: SpotifyPlaylistBlockedReason) {
    super("Spotify rejected playlist read under client credentials.");
    this.name = "SpotifyPlaylistBlockedError";
    this.reason = reason;
  }
}

/**
 * Spotify's algorithmic / personalized playlists ship under the `spotify` user with ids
 * that start with the `37i9dQZF1E` prefix (Daily Mix, Discover Weekly, Release Radar,
 * every "Made For You"). Editorial playlists (Today's Top Hits, etc.) use the sibling
 * `37i9dQZF1D` prefix and ARE readable under Client Credentials.
 *
 * This is a best-effort hint, not a guarantee — Spotify has never documented these
 * prefixes — but it lets us label a 403 as "(likely personalized)" so the operator knows
 * why and so we route the right copy to the renderer without an extra HEAD call.
 */
function isLikelyPersonalizedSpotifyPlaylistId(id: string): boolean {
  return /^37i9dQZF1E/i.test((id ?? "").trim());
}

/**
 * Spotify uses both 2-letter locales (`intl-en`, `intl-iw`) AND multi-segment locales
 * (`intl-pt-br`, `intl-zh-tw`, `intl-zh-cn`). Match the whole `intl-…` segment up to
 * the next `/` so every locale variant routes to the same album/playlist id.
 *
 * The capture group is the kind (`playlist` | `album`); the id is the next path segment
 * minus any trailing `/`, `?`, `#`. Query string (`?si=…`) lives in `URL.search` and
 * never enters the pathname, so share-link tracking ids are dropped automatically.
 */
const SPOTIFY_PATH_RE = /^\/(?:intl-[a-z][a-z0-9-]{1,9}\/)?(playlist|album)\/([^/?#]+)/i;

/**
 * Spotify URI scheme drag-from-Desktop payload (`spotify:album:<id>` /
 * `spotify:playlist:<id>`). The client helper normalises this before posting, but the
 * route accepts it as well so a hand-rolled call works the same way.
 */
const SPOTIFY_URI_RE = /^spotify:(playlist|album):([A-Za-z0-9]+)\b/i;

function normalizeSpotifyShareInput(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return s;
  const m = s.match(SPOTIFY_URI_RE);
  if (m) return `https://open.spotify.com/${m[1].toLowerCase()}/${m[2]}`;
  return s;
}

/**
 * Recognises both `open.spotify.com` and `spotify.com`, with or without `/intl-XX[-YY]/`
 * locale prefix. Not exported — Next.js route files only allow HTTP-verb / config exports.
 * The renderer has its own copy in `lib/spotify-playlist-import-client.ts`.
 */
function parseSpotifyPlaylistOrAlbumUrl(url: string): { kind: "playlist" | "album"; id: string } | null {
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

async function fetchSpotifyAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Spotify token request failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token.trim()) {
    throw new Error("Spotify token: missing access_token");
  }
  return data.access_token;
}

type SpotifyArtistRef = { name?: unknown };
type SpotifyTrackJson = { name?: unknown; duration_ms?: unknown; artists?: unknown };
type PlaylistItemJson = { track?: unknown };

function joinArtistNames(artists: unknown): string {
  if (!Array.isArray(artists)) return "";
  const names = (artists as SpotifyArtistRef[])
    .map((a) => (typeof a?.name === "string" ? a.name.trim() : ""))
    .filter((n) => n.length > 0);
  return names.join(", ");
}

function isSpotifyTrackJson(v: unknown): v is SpotifyTrackJson {
  return !!v && typeof v === "object";
}

async function fetchPlaylistPreview(
  playlistId: string,
  token: string,
): Promise<{ name: string; ownerName?: string; totalTracks: number; tracks: SpotifyPreviewTrack[] }> {
  const metaRes = await fetch(
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}?fields=name,owner(display_name),tracks(total)`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), cache: "no-store" },
  );
  if (metaRes.status === 404) {
    /**
     * Personalized playlists (Daily Mix, Discover Weekly, every "Made For <user>") sit
     * behind the `37i9dQZF1E` id prefix and Spotify returns `HTTP 404` for them under
     * Client Credentials — not 403, even though the cause is the same ACL gate. Treat
     * that exact prefix-on-404 as `playlist_blocked/personalized` so the renderer shows
     * the same "Spotify blocked access…" copy + Paste tracklist CTA it already shows
     * for 403. Non-personalized ids on 404 stay a real "not found" (deleted/private).
     */
    if (isLikelyPersonalizedSpotifyPlaylistId(playlistId)) {
      throw new SpotifyPlaylistBlockedError("personalized");
    }
    throw new Error("Playlist not found or not public.");
  }
  if (metaRes.status === 403) {
    /**
     * Spotify routinely 403s personalized / Made-For-You / private / collaborative playlist
     * reads under Client Credentials. The ID-prefix hint distinguishes "almost certainly
     * personalized" from "could be private". Either way the user-facing copy is the same.
     */
    throw new SpotifyPlaylistBlockedError(
      isLikelyPersonalizedSpotifyPlaylistId(playlistId) ? "personalized" : "private_or_blocked",
    );
  }
  if (!metaRes.ok) throw new Error(`Spotify playlist metadata: HTTP ${metaRes.status}`);
  const meta = (await metaRes.json()) as {
    name?: unknown;
    owner?: { display_name?: unknown };
    tracks?: { total?: unknown };
  };
  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  const ownerName = typeof meta.owner?.display_name === "string" ? meta.owner.display_name.trim() : "";
  const declaredTotal = typeof meta.tracks?.total === "number" ? meta.tracks.total : 0;
  const tracks: SpotifyPreviewTrack[] = [];
  let offset = 0;
  const cap = Math.min(declaredTotal || MAX_TRACKS_RETURNED, MAX_TRACKS_RETURNED);

  while (offset < cap) {
    const tracksUrl =
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks` +
      `?fields=items(track(name,duration_ms,artists(name)))&limit=${PLAYLIST_PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(tracksUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.status === 403) {
      throw new SpotifyPlaylistBlockedError(
        isLikelyPersonalizedSpotifyPlaylistId(playlistId) ? "personalized" : "private_or_blocked",
      );
    }
    if (res.status === 404 && isLikelyPersonalizedSpotifyPlaylistId(playlistId)) {
      /**
       * Some personalized ids 200 on the metadata call (with stripped owner/name) but
       * 404 the `/tracks` page. Same gate, same fix: route the personalized prefix on
       * 404 into `playlist_blocked/personalized` so the renderer keeps the inline copy
       * + Paste tracklist CTA. Non-personalized 404 here = playlist deleted mid-fetch,
       * keep the generic error so we don't lie about why.
       */
      throw new SpotifyPlaylistBlockedError("personalized");
    }
    if (!res.ok) throw new Error(`Spotify playlist tracks: HTTP ${res.status}`);
    const data = (await res.json()) as { items?: unknown };
    const items = Array.isArray(data.items) ? (data.items as PlaylistItemJson[]) : [];
    if (items.length === 0) break;
    for (const item of items) {
      const trackVal = item?.track;
      if (!isSpotifyTrackJson(trackVal)) continue;
      const title = typeof trackVal.name === "string" ? trackVal.name.trim() : "";
      if (!title) continue;
      const artist = joinArtistNames(trackVal.artists);
      const durationMs = typeof trackVal.duration_ms === "number" ? trackVal.duration_ms : 0;
      tracks.push({ playlistOrder: tracks.length, artist, title, durationMs });
      if (tracks.length >= cap) break;
    }
    if (tracks.length >= cap) break;
    if (items.length < PLAYLIST_PAGE_SIZE) break;
    offset += items.length;
  }

  return {
    name: name || "Spotify playlist",
    ownerName: ownerName || undefined,
    totalTracks: declaredTotal || tracks.length,
    tracks,
  };
}

async function fetchAlbumPreview(
  albumId: string,
  token: string,
): Promise<{ name: string; ownerName?: string; totalTracks: number; tracks: SpotifyPreviewTrack[] }> {
  /**
   * `/v1/albums/{id}` does not accept a `fields` filter (only `market` per Spotify docs).
   * We fetch the full album object once for `name`, `artists`, and `tracks.total`, then walk
   * `/v1/albums/{id}/tracks?limit=50` for the canonical ordered track list. We deliberately
   * ignore the first call's embedded `tracks.items` to keep the pagination loop the single
   * source of truth for ordering (it consistently honours Spotify's track_number sort).
   */
  const metaRes = await fetch(
    `https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), cache: "no-store" },
  );
  if (metaRes.status === 404) throw new Error("Album not found.");
  if (!metaRes.ok) throw new Error(`Spotify album metadata: HTTP ${metaRes.status}`);
  const meta = (await metaRes.json()) as {
    name?: unknown;
    artists?: unknown;
    total_tracks?: unknown;
    tracks?: { total?: unknown };
  };
  const albumName = typeof meta.name === "string" ? meta.name.trim() : "";
  const albumArtists = joinArtistNames(meta.artists);
  const declaredTotal =
    (typeof meta.tracks?.total === "number" ? meta.tracks.total : 0) ||
    (typeof meta.total_tracks === "number" ? meta.total_tracks : 0);
  const tracks: SpotifyPreviewTrack[] = [];
  let offset = 0;
  const cap = Math.min(declaredTotal || MAX_TRACKS_RETURNED, MAX_TRACKS_RETURNED);

  while (offset < cap) {
    const tracksUrl =
      `https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}/tracks?limit=${ALBUM_PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(tracksUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Spotify album tracks: HTTP ${res.status}`);
    const data = (await res.json()) as { items?: unknown };
    const items = Array.isArray(data.items) ? (data.items as SpotifyTrackJson[]) : [];
    if (items.length === 0) break;
    for (const item of items) {
      if (!isSpotifyTrackJson(item)) continue;
      const title = typeof item.name === "string" ? item.name.trim() : "";
      if (!title) continue;
      const trackArtists = joinArtistNames(item.artists);
      const artist = trackArtists || albumArtists;
      const durationMs = typeof item.duration_ms === "number" ? item.duration_ms : 0;
      tracks.push({ playlistOrder: tracks.length, artist, title, durationMs });
      if (tracks.length >= cap) break;
    }
    if (tracks.length >= cap) break;
    if (items.length < ALBUM_PAGE_SIZE) break;
    offset += items.length;
  }

  return {
    name: albumName || "Spotify album",
    ownerName: albumArtists || undefined,
    totalTracks: declaredTotal || tracks.length,
    tracks,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse<SpotifyPlaylistPreviewResult>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const url =
    raw && typeof raw === "object" && typeof (raw as { url?: unknown }).url === "string"
      ? ((raw as { url: string }).url ?? "").trim()
      : "";
  if (!url) {
    return NextResponse.json({ status: "error", message: "url is required" }, { status: 400 });
  }
  const parsed = parseSpotifyPlaylistOrAlbumUrl(url);
  if (!parsed) {
    return NextResponse.json(
      { status: "error", message: "Not a Spotify playlist or album URL." },
      { status: 400 },
    );
  }

  const clientId = (process.env.SPOTIFY_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    return NextResponse.json({ status: "not_configured" }, { status: 503 });
  }

  let token: string;
  try {
    token = await fetchSpotifyAccessToken(clientId, clientSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Spotify authentication failed.";
    return NextResponse.json({ status: "error", message: msg }, { status: 502 });
  }

  try {
    const result =
      parsed.kind === "playlist"
        ? await fetchPlaylistPreview(parsed.id, token)
        : await fetchAlbumPreview(parsed.id, token);
    if (result.tracks.length === 0) {
      return NextResponse.json(
        { status: "error", message: "No playable tracks were returned by Spotify for this link." },
        { status: 502 },
      );
    }
    return NextResponse.json({ status: "ok", kind: parsed.kind, ...result });
  } catch (e) {
    /**
     * Personalized / Made-For-You / private / collaborative playlists are gated behind
     * user OAuth; Client Credentials reads return HTTP 403. Surface a stable structured
     * status (`playlist_blocked`) carrying the exact required inline string so the
     * renderer never has to template against ad-hoc error text.
     */
    if (e instanceof SpotifyPlaylistBlockedError) {
      return NextResponse.json(
        {
          status: "playlist_blocked",
          reason: e.reason,
          message:
            "Spotify blocked access to this playlist. You can paste the tracklist manually, try a Spotify album, or connect Spotify account later.",
        },
        { status: 200 },
      );
    }
    const msg = e instanceof Error ? e.message : "Spotify request failed.";
    return NextResponse.json({ status: "error", message: msg }, { status: 502 });
  }
}
