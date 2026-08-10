/**
 * Phase C — the EXACT contract the desktop sends to build a UniversalPlaylist from an M3U it
 * ALREADY resolved (desktop/src/main/import-local-m3u-playlist.ts: local-bank matches +
 * YouTube fallback). The server does NOT re-parse, re-scan, or re-resolve the M3U — it only
 * consumes these resolved entries.
 *
 * PRIVACY: a `local` entry carries an OPAQUE `localRef` (hashed on the desktop) + a bare
 * `filename`. The absolute path never leaves the desktop and never appears here.
 *
 * (Desktop-side mapping of its internal `files`/`trackDisplayNames`/`resolvedSourceOrders`/
 * `unresolved` arrays into this payload is a desktop-main step delivered via installer.)
 */

import type { NormalizedTrack } from "@/lib/universal/universal-track";

export interface DesktopEntryEnrichment {
  bpm?: number | null;
  comment?: string | null;
  rating?: number | null;
  genres?: string[] | null;
  year?: string | null;
  isrc?: string | null;
  metadataHash?: string | null;
}

export type DesktopPlaylistEntry =
  | { kind: "local"; position: number; title: string; artists?: string[]; durationMs?: number | null; localRef: string; filename: string; availability?: "available" | "missing"; enrichment?: DesktopEntryEnrichment }
  | { kind: "youtube"; position: number; title: string; artists?: string[]; durationMs?: number | null; videoId: string; url?: string; enrichment?: DesktopEntryEnrichment }
  | { kind: "unresolved"; position: number; title: string; artists?: string[]; durationMs?: number | null; enrichment?: DesktopEntryEnrichment };

export interface DesktopM3uPayload {
  name: string;
  /** Deterministic idempotency key (e.g. "desktop-m3u:<device>:<playlist>"). */
  sourceKey: string;
  sourceUrl?: string;
  entries: DesktopPlaylistEntry[];
}

function artistsToNormalized(names?: string[]) {
  return (names ?? []).map((displayName, order) => ({ displayName, order, role: order === 0 ? "primary" : "featured" }));
}

/** Consume a resolved desktop payload → NormalizedTrack[] (order preserved). No re-resolution. */
export function desktopPayloadToNormalizedTracks(payload: DesktopM3uPayload): NormalizedTrack[] {
  return [...payload.entries]
    .sort((a, b) => a.position - b.position)
    .map((e): NormalizedTrack => {
      const en = e.enrichment;
      const base = {
        displayTitle: e.title,
        artists: artistsToNormalized(e.artists),
        durationMs: e.durationMs ?? undefined,
        isrc: en?.isrc ?? undefined,
        enrichment: en ? { bpm: en.bpm, comment: en.comment, rating: en.rating, genres: en.genres, year: en.year, metadataHash: en.metadataHash } : undefined,
      };
      if (e.kind === "youtube") {
        return { ...base, providerRef: { provider: "youtube", externalId: e.videoId, externalUrl: e.url, playableStatus: "PLAYABLE" } };
      }
      if (e.kind === "local") {
        // localRef is already an opaque hash produced by the desktop — NOT a path.
        return { ...base, providerRef: { provider: "local", externalId: e.localRef }, raw: { filename: e.filename, availability: e.availability } };
      }
      return base; // unresolved → the resolver decides
    });
}
