/**
 * Device-local resume identity for LOCAL playback (reboot auto-resume).
 *
 * WHY: the recovery snapshot (lib/playback-provider.tsx) persists only source/queue IDs and rebuilds
 * sources from the server on restore. That works for URL / streaming / catalog sources — the server
 * knows their `url` by id — so URL playback resumes after a reboot. It does NOT work for LOCAL files:
 *   - ephemeral / My-Music / dropped-file / played-folder sources have a device-only `playnext-…` or
 *     `ephemeral-local-folder:…` id that the server never knows → id lookup misses → snapshot wiped;
 *   - a folder DB source persists only the ROOT folder path (the individual files are scanned at
 *     runtime, never persisted) → the restored source has no playable FILE.
 * Either way the exact local file that was playing can't be reconstructed from the server, so local
 * playback silently fails to resume while URL playback resumes.
 *
 * FIX: also capture the concrete local file path(s) that were actually playing and keep them in the
 * DEVICE-ONLY recovery snapshot (localStorage — never sent over WebSocket, so this does NOT reintroduce
 * the local-path leak that lib/remote-control/* deliberately strips from WS payloads). On restore, when
 * the id-based path cannot yield the exact local file, reconstruct a local source from these paths.
 *
 * These are PURE functions (no DOM / MPV / DB / network) so the resume decision is deterministically
 * unit-testable without the desktop runtime.
 */
import { createPlayNextLocalSource } from "@/lib/play-next";
import { buildEphemeralLocalFolderPlaylist } from "@/lib/ephemeral-local-music-playback";
import { isValidLocalFilePlaybackPath } from "@/lib/url-validation";
import { unifiedPlaylistSourceId } from "@/lib/playlist-utils";
import { EPHEMERAL_LOCAL_PLAYLIST_PREFIX } from "@/lib/local-playlist-artwork";
import { getPlaylistTracks } from "@/lib/playlist-types";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";

export type LocalRecovery = {
  /** Absolute local path of the track that was playing — the authoritative resume target. */
  currentUrl: string;
  /** Absolute local paths of the full local session (for next/prev continuation). Optional. */
  queueUrls?: string[];
  title?: string;
  cover?: string | null;
};

/**
 * Shape the device-local resume identity from the LIVE resolved play url(s). Returns `undefined` when
 * the current source is NOT a local file (e.g. a URL / stream). URL sessions therefore store nothing
 * here and their restore behavior is completely unchanged.
 */
export function captureLocalRecovery(args: {
  currentPlayUrl: string | null | undefined;
  queuePlayUrls?: (string | null | undefined)[];
  title?: string | null;
  cover?: string | null;
}): LocalRecovery | undefined {
  const cur = (args.currentPlayUrl ?? "").trim();
  if (!isValidLocalFilePlaybackPath(cur)) return undefined;
  const rec: LocalRecovery = { currentUrl: cur };
  const q = (args.queuePlayUrls ?? [])
    .map((u) => (u ?? "").trim())
    .filter((u) => isValidLocalFilePlaybackPath(u));
  if (q.length > 1) rec.queueUrls = q;
  const title = (args.title ?? "").trim();
  if (title) rec.title = title;
  if (typeof args.cover === "string" && args.cover.trim()) rec.cover = args.cover.trim();
  return rec;
}

/** Validate/normalize a persisted `local` blob coming back from storage (untrusted JSON). */
export function sanitizeLocalRecovery(raw: unknown): LocalRecovery | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<LocalRecovery>;
  const cur = typeof r.currentUrl === "string" ? r.currentUrl.trim() : "";
  if (!isValidLocalFilePlaybackPath(cur)) return undefined;
  const rec: LocalRecovery = { currentUrl: cur };
  if (Array.isArray(r.queueUrls)) {
    const q = r.queueUrls
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => isValidLocalFilePlaybackPath(x));
    if (q.length > 1) rec.queueUrls = q;
  }
  if (typeof r.title === "string" && r.title.trim()) rec.title = r.title.trim();
  if (typeof r.cover === "string" && r.cover.trim()) rec.cover = r.cover.trim();
  else if (r.cover === null) rec.cover = null;
  return rec;
}

/**
 * True when the id-based restore cannot play the EXACT local file that was playing, so we must
 * reconstruct from the device-local paths. False for URL sessions (`rec` undefined) and for local
 * sessions the id path already restores correctly (e.g. a saved local playlist whose file the server
 * returns intact) — those paths are left completely unchanged.
 */
export function needsLocalReconstruction(
  idResolvedPlayUrl: string | null | undefined,
  rec: LocalRecovery | undefined,
): boolean {
  if (!rec?.currentUrl) return false;
  const u = (idResolvedPlayUrl ?? "").trim();
  // id path already yields the same local file → keep the (richer) id-based source.
  if (isValidLocalFilePlaybackPath(u) && u === rec.currentUrl) return false;
  return true;
}

/**
 * Reconstruct a playable local UnifiedSource from the device-local resume identity. A multi-file session
 * becomes an ephemeral local folder playlist (so next/prev keep working); a single file becomes one
 * local source. Returns `null` when there is no valid local path to restore.
 */
export function reconstructLocalSourceFromSnapshot(
  rec: LocalRecovery | undefined,
): { source: UnifiedSource; trackIndex: number } | null {
  if (!rec?.currentUrl || !isValidLocalFilePlaybackPath(rec.currentUrl)) return null;
  const queue = (rec.queueUrls ?? []).filter((u) => isValidLocalFilePlaybackPath(u));
  if (queue.length > 1) {
    const playlist = buildEphemeralLocalFolderPlaylist(queue, {
      folderLabel: rec.title,
      thumbnail: rec.cover ?? null,
    });
    const idx = Math.max(0, queue.indexOf(rec.currentUrl));
    const source: UnifiedSource = {
      id: unifiedPlaylistSourceId(playlist.id),
      title: playlist.name,
      genre: playlist.genre || "Mixed",
      cover: rec.cover ?? playlist.cover ?? null,
      type: "local",
      url: playlist.url,
      origin: "playlist",
      playlist,
    };
    return { source, trackIndex: idx };
  }
  const source = createPlayNextLocalSource(rec.currentUrl, rec.cover ?? null);
  return { source, trackIndex: 0 };
}

/**
 * Device-only reconstruction blob for an EPHEMERAL playlist source whose tracks are NOT local files —
 * e.g. the Royalty-Free / Music Bank catalog (tracks are `/api/media/<assetId>` HTTP URLs). Its id
 * (`ephemeral-local-folder:musicbank-…`) is generated client-side and never known to the server, so it
 * can't be rebuilt from `fetchUnifiedSourcesWithFallback()` after a reboot, and `local-recovery` above
 * can't help because the tracks aren't local paths. Persisting the source itself (device-only,
 * localStorage) lets restore rebuild the exact catalog session. Complements — never replaces — the
 * `LocalRecovery` block above (which stays the sole owner of local-file resume).
 */
export type EphemeralTrack = { id: string; name: string; type: string; url: string; cover?: string };
export type EphemeralSourceRecovery = {
  sourceId: string; // the ephemeral UnifiedSource id (== its playlist id)
  title: string;
  genre: string;
  type: string; // SourceProviderType, e.g. "stream-url" (Music Bank) or "local"
  url: string;
  cover: string | null;
  tracks: EphemeralTrack[];
};

/** Capture an ephemeral playlist source for reboot resume. Returns undefined for anything that is not an
 *  ephemeral playlist with reconstructable tracks (so non-ephemeral / server-known sources are untouched). */
export function captureEphemeralSource(source: UnifiedSource | null | undefined): EphemeralSourceRecovery | undefined {
  const pl = source?.playlist;
  if (!source || !pl?.id || !pl.id.startsWith(EPHEMERAL_LOCAL_PLAYLIST_PREFIX)) return undefined;
  const tracks: EphemeralTrack[] = getPlaylistTracks(pl)
    .map((t) => ({ id: t.id, name: t.name, type: String(t.type), url: (t.url ?? "").trim(), ...(t.cover ? { cover: t.cover } : {}) }))
    .filter((t) => !!t.url);
  if (tracks.length === 0) return undefined;
  return {
    sourceId: source.id,
    title: source.title,
    genre: source.genre,
    type: String(source.type),
    url: (source.url ?? tracks[0]!.url).trim(),
    cover: source.cover ?? null,
    tracks,
  };
}

/** Validate/normalize a persisted ephemeral blob from storage (untrusted JSON). */
export function sanitizeEphemeralSource(raw: unknown): EphemeralSourceRecovery | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<EphemeralSourceRecovery>;
  if (typeof r.sourceId !== "string" || !r.sourceId || !Array.isArray(r.tracks)) return undefined;
  const tracks = r.tracks
    .filter((t): t is EphemeralTrack => !!t && typeof t === "object" && typeof (t as EphemeralTrack).url === "string")
    .map((t) => ({ id: String(t.id ?? ""), name: String(t.name ?? ""), type: String(t.type ?? "stream-url"), url: t.url.trim(), ...(typeof t.cover === "string" && t.cover ? { cover: t.cover } : {}) }))
    .filter((t) => !!t.url);
  if (tracks.length === 0) return undefined;
  return {
    sourceId: r.sourceId,
    title: typeof r.title === "string" ? r.title : "",
    genre: typeof r.genre === "string" && r.genre ? r.genre : "Mixed",
    type: typeof r.type === "string" && r.type ? r.type : "stream-url",
    url: typeof r.url === "string" && r.url.trim() ? r.url.trim() : tracks[0]!.url,
    cover: typeof r.cover === "string" && r.cover ? r.cover : null,
    tracks,
  };
}

/** Rebuild a playable UnifiedSource (+ ephemeral playlist) from the blob. Returns null if unusable. */
export function reconstructEphemeralSource(
  rec: EphemeralSourceRecovery | undefined,
  preferredTrackIndex: number,
): { source: UnifiedSource; trackIndex: number } | null {
  if (!rec?.sourceId || !Array.isArray(rec.tracks) || rec.tracks.length === 0) return null;
  const tracks: PlaylistTrack[] = rec.tracks.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type as PlaylistTrack["type"],
    url: t.url,
    ...(t.cover ? { cover: t.cover } : {}),
  }));
  const thumb = (rec.cover ?? "").trim();
  const playlist: Playlist = {
    id: rec.sourceId, // ephemeral prefix preserved → playSource skips /api/playlists hydration
    name: rec.title || "Samples",
    genre: rec.genre || "Mixed",
    type: rec.type as Playlist["type"],
    url: rec.url,
    thumbnail: thumb,
    ...(thumb ? { cover: thumb } : {}),
    createdAt: new Date().toISOString(),
    tracks,
    order: tracks.map((t) => t.id),
  };
  const source: UnifiedSource = {
    id: rec.sourceId,
    title: rec.title || playlist.name,
    genre: rec.genre || "Mixed",
    cover: rec.cover ?? null,
    type: rec.type as UnifiedSource["type"],
    url: rec.url,
    origin: "playlist",
    playlist,
  };
  const idx = Math.min(Math.max(0, preferredTrackIndex), tracks.length - 1);
  return { source, trackIndex: idx };
}
