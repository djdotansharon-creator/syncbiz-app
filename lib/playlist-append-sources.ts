import type { Playlist, PlaylistTrack } from "./playlist-types";
import { getPlaylistTracks } from "./playlist-types";
import type { UnifiedSource } from "./source-types";
import { canonicalYouTubeWatchUrlForPlayback } from "./playlist-utils";

/** Normalize URL for duplicate detection within a playlist (same playable URL = duplicate). */
export function playableUrlKey(type: PlaylistTrack["type"], url: string): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (type === "youtube") {
    return canonicalYouTubeWatchUrlForPlayback(u).trim().toLowerCase();
  }
  return u.toLowerCase();
}

function newTrackId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTrackRow(t: PlaylistTrack): PlaylistTrack {
  const name = t.name || (t as PlaylistTrack & { title?: string }).title || "Untitled";
  return {
    ...t,
    id: (t.id ?? "").trim(),
    name,
    url: (t.url ?? "").trim(),
    type: t.type,
  };
}

function isHttpUrl(u: string): boolean {
  const t = (u ?? "").trim().toLowerCase();
  return t.startsWith("http://") || t.startsWith("https://");
}

/**
 * Legacy "Your Playlist" shell row created at playlist creation time:
 * one local://user-playlist row mirroring playlist id/url/type.
 */
function isLegacyLocalShellTrack(t: PlaylistTrack, p: Playlist): boolean {
  const tu = (t.url ?? "").trim();
  const pu = (p.url ?? "").trim();
  return (
    (t.id ?? "").trim() === (p.id ?? "").trim() &&
    tu.length > 0 &&
    tu === pu &&
    t.type === p.type &&
    tu.startsWith("local://user-playlist/")
  );
}

/**
 * Tracks in `order` sequence (when present), then any row in `tracks[]` not referenced by that
 * sequence ("orphans"), in storage order. Matches `getPlaylistTracks` for legacy shell-only playlists.
 * Used before append so PUT never drops orphans that `getPlaylistTracks` would omit.
 */
export function reconcilePlaylistTracksForMerge(p: Playlist): PlaylistTrack[] {
  if (!p.tracks || p.tracks.length === 0) {
    return getPlaylistTracks(p);
  }
  const byId = new Map<string, PlaylistTrack>();
  for (const t of p.tracks) {
    const id = (t.id ?? "").trim();
    if (id && !byId.has(id)) {
      byId.set(id, t);
    }
  }
  const orderIds =
    p.order && p.order.length > 0
      ? p.order.map((id) => String(id).trim()).filter(Boolean)
      : p.tracks.map((t) => (t.id ?? "").trim()).filter(Boolean);
  const out: PlaylistTrack[] = [];
  const seen = new Set<string>();
  for (const oid of orderIds) {
    const t = byId.get(oid);
    if (t && !seen.has(oid)) {
      seen.add(oid);
      out.push(normalizeTrackRow(t));
    }
  }
  for (const t of p.tracks) {
    const id = (t.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(normalizeTrackRow(t));
  }
  return out;
}

/** Expand one library item into zero or more `PlaylistTrack` rows (playlist shell → its tracks). */
function flattenOneSourceToTracks(s: UnifiedSource): PlaylistTrack[] {
  if (s.origin === "playlist" && s.playlist && !s.id.includes(":track:")) {
    /** Match append merge: include order + orphan rows (same as `appendSourcesToPlaylistTracks`). */
    const pts = reconcilePlaylistTracksForMerge(s.playlist);
    return pts.map((pt) => ({
      id: newTrackId(),
      name: pt.name || (pt as { title?: string }).title || "Untitled",
      type: pt.type,
      url: (pt.url ?? "").trim(),
      cover: pt.cover,
      catalogItemId: pt.catalogItemId,
    }));
  }
  const url = (s.url ?? "").trim();
  if (!url) return [];
  return [
    {
      id: newTrackId(),
      name: (s.title ?? "").trim() || "Untitled",
      type: s.type as PlaylistTrack["type"],
      url,
      cover: s.cover ?? undefined,
      catalogItemId: (s as { catalogItemId?: string }).catalogItemId,
    },
  ];
}

/**
 * Maps dropped sources to new tracks, skipping URLs already present in `existingUrlKeys`
 * (keys are updated as tracks are accepted). Appends only — order follows `sources` iteration.
 */
export function collectAppendTracksForPlaylist(
  sources: UnifiedSource[],
  existingUrlKeys: Set<string>,
): { tracks: PlaylistTrack[]; skippedByDedupe: number } {
  const out: PlaylistTrack[] = [];
  let skippedByDedupe = 0;
  for (const s of sources) {
    for (const t of flattenOneSourceToTracks(s)) {
      const u = (t.url ?? "").trim();
      if (!u) {
        skippedByDedupe += 1;
        continue;
      }
      const key = playableUrlKey(t.type, u);
      if (!key) {
        skippedByDedupe += 1;
        continue;
      }
      if (existingUrlKeys.has(key)) {
        skippedByDedupe += 1;
        continue;
      }
      existingUrlKeys.add(key);
      out.push({ ...t, url: u });
    }
  }
  return { tracks: out, skippedByDedupe };
}

/**
 * Append dropped sources to the end of the playlist. Rebuilds `order` to match merged `tracks`.
 * Does not persist — caller runs GET/PUT.
 */
export function appendSourcesToPlaylistTracks(
  playlist: Playlist,
  sources: UnifiedSource[],
): { tracks: PlaylistTrack[]; order: string[]; addedCount: number; skippedByDedupe: number } {
  const existingOrdered = reconcilePlaylistTracksForMerge(playlist);
  const existingUrlKeys = new Set(existingOrdered.map((t) => playableUrlKey(t.type, (t.url ?? "").trim())));
  const { tracks: newTracks, skippedByDedupe } = collectAppendTracksForPlaylist(sources, existingUrlKeys);

  let baseExisting = existingOrdered;
  if (
    existingOrdered.length === 1 &&
    isLegacyLocalShellTrack(existingOrdered[0], playlist) &&
    newTracks.some((t) => isHttpUrl(t.url))
  ) {
    // First real HTTP append to a legacy local shell playlist:
    // replace the shell row instead of producing mixed URL schemes.
    baseExisting = [];
  }

  const merged = [...baseExisting, ...newTracks];
  const order = merged.map((t) => t.id);
  return {
    tracks: merged,
    order,
    addedCount: newTracks.length,
    skippedByDedupe,
  };
}
