/**
 * Phase A1/A2 — platform-agnostic domain types.
 *
 * These are the in-memory, normalized shapes a PlatformReader produces. They mirror
 * the Prisma models in the "UNIVERSAL MUSIC IDENTITY" section of schema.prisma but
 * are deliberately decoupled from the generated client so readers, tests, and future
 * resolver code can pass tracks around without a DB round-trip. Persistence (mapping
 * these onto UniversalTrack / Artist / ProviderMapping / …) is a LATER step — nothing
 * here writes to the database.
 */

import type { MusicStreamingProvider } from "@/lib/source-types";

/** Provider identifiers used by the universal layer (superset of the URL-ingest providers). */
export type UniversalProvider = MusicStreamingProvider | "m3u" | "local" | "radio";

/** Mirrors the Prisma `TrackVersionType` enum (kept as a string union to avoid a client dependency). */
export type TrackVersionName =
  | "ORIGINAL"
  | "RADIO_EDIT"
  | "EXTENDED"
  | "REMIX"
  | "LIVE"
  | "ACOUSTIC"
  | "INSTRUMENTAL"
  | "REMASTER"
  | "COVER"
  | "KARAOKE"
  | "SPED_UP"
  | "SLOWED"
  | "OTHER";

/** Mirrors the Prisma `ProviderPlayableStatus` enum. */
export type ProviderPlayableStatusName = "PLAYABLE" | "RESTRICTED" | "UNAVAILABLE" | "UNKNOWN";

export interface NormalizedArtist {
  /** Original casing for display. */
  displayName: string;
  /** 0-based credit order (primary first). */
  order: number;
  /** "primary" | "featured" | "remixer" | … (free-form). */
  role?: string;
}

/** A concrete location of a recording on one provider. */
export interface NormalizedProviderRef {
  provider: UniversalProvider;
  externalId: string;
  externalUrl?: string;
  providerIsrc?: string;
  playableStatus?: ProviderPlayableStatusName;
  /** 0..1 confidence this ref is the correct recording (set by the resolver, not the reader). */
  matchConfidence?: number;
}

/** Release/album context, when a reader can supply it. */
export interface NormalizedRelease {
  albumTitle?: string;
  releaseDate?: string; // ISO 8601
  label?: string;
  artworkUrl?: string;
  provider?: UniversalProvider;
  externalId?: string;
}

/**
 * A single normalized track as read from some platform. This is NOT yet a canonical
 * UniversalTrack — it is the raw material the resolver will later dedupe/merge.
 */
export interface NormalizedTrack {
  displayTitle: string;
  /** Lowercased/stripped title; readers may leave undefined and let the resolver compute it. */
  normalizedTitle?: string;
  artists: NormalizedArtist[];
  durationMs?: number;
  isrc?: string;
  versionType?: TrackVersionName;
  explicit?: boolean;
  release?: NormalizedRelease;
  /** The provider location this track was read from (the "self" ref). */
  providerRef?: NormalizedProviderRef;
  /** Rich per-track enrichment (from local MP3 tags / Excel) carried to the playlist item. */
  enrichment?: {
    bpm?: number | null;
    comment?: string | null;
    rating?: number | null;
    genres?: string[] | null;
    year?: string | null;
    metadataHash?: string | null;
  };
  /** Original provider payload, kept for provenance/debugging (never persisted verbatim). */
  raw?: unknown;
}

export type NormalizedCollectionKind = "playlist" | "album" | "mix" | "m3u";

/** A normalized playlist/album/mix a reader returns from readPlaylist / readAlbum. */
export interface NormalizedCollection {
  title: string;
  kind: NormalizedCollectionKind;
  sourceProvider: UniversalProvider;
  sourceUrl?: string;
  /** Total as reported by the source (may exceed `tracks.length` if the reader capped). */
  totalTracks: number;
  tracks: NormalizedTrack[];
  /** Entries the reader could not parse into a track (for the "missing" report). */
  unreadable?: Array<{ raw: unknown; reason: string }>;
}

/** Convenience: a single primary-artist helper for legacy single-string artist fields. */
export function singleArtist(displayName: string | null | undefined): NormalizedArtist[] {
  const name = (displayName ?? "").trim();
  return name ? [{ displayName: name, order: 0, role: "primary" }] : [];
}
