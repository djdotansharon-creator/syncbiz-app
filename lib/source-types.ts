/**
 * Unified Source type for the Sources library view.
 * Normalizes Playlist and db Source into a single display format.
 */

import type { Playlist } from "./playlist-types";
import type {
  Source,
  ContentNodeKind,
  ExecutionTarget,
  EngineSelectionPolicy,
  MixStrategyId,
  TaxonomyTag,
  PlaybackEngineType,
  ResolveMediaKind,
} from "./types";
import { classifyResolveFoundation } from "./url-resolve-classify";
import { getPlaylistTracks } from "./playlist-types";
import {
  leafContractSubtypeFromContentNode,
  shouldClassifyLeafUrlAsMixSet,
} from "./library-leaf-mix-heuristics";

export type SourceProviderType = "youtube" | "soundcloud" | "spotify" | "local" | "stream-url" | "winamp";

/** Stage 6B — Library paste/drop routing for external music links (foundation). */
export type MusicStreamingProvider =
  | "spotify"
  | "apple_music"
  | "beatport"
  | "juno_download"
  | "deezer"
  | "tidal"
  | "amazon_music"
  | "qobuz"
  | "beatsource"
  | "bandcamp"
  | "shazam"
  | "soundcloud"
  | "youtube"
  | "youtube_music"
  | "generic_music_url";

export type MusicUrlIngestIntent =
  | "direct_playable"
  | "resolve_to_youtube"
  | "unsupported_playlist_or_album"
  | "unknown";

/** URL-only classification — no candidate picker yet. */
export type MusicUrlIngestClassification = {
  provider: MusicStreamingProvider;
  intent: MusicUrlIngestIntent;
};

/** Library architecture contract: top-level entity kind. */
export type LibraryEntityKind = "collection" | "item";

/** Managed/curated containers shown in the library rail and collection views. */
export type LibraryCollectionSubtype =
  | "syncbiz_playlist"
  | "external_playlist"
  | "genre_collection"
  | "daypart_collection"
  | "client_collection";

/** Media items rendered inside collections/containers. */
export type LibraryItemSubtype = "single_track" | "mix_set" | "radio_stream" | "ai_asset";

export type LibraryEntityContract =
  | { entityKind: "collection"; collectionSubtype: LibraryCollectionSubtype }
  | { entityKind: "item"; itemSubtype: LibraryItemSubtype };

/** Optional foundation metadata shared by parse-url, unified API, and UnifiedSource (additive). */
export type UnifiedSourceFoundation = {
  contentNodeKind?: ContentNodeKind;
  /** Parallel coarse hint for tooling; prefer contentNodeKind when in doubt. */
  mediaKind?: ResolveMediaKind;
  executionTarget?: ExecutionTarget;
  engineSelectionPolicy?: EngineSelectionPolicy;
  mixStrategyHint?: MixStrategyId;
  taxonomyTags?: TaxonomyTag[];
  /** Future: control-plane execution adapter id. */
  executionAdapterId?: string;
  /** Future: preferred engine for this source (metadata). */
  preferredEngineType?: PlaybackEngineType;
};

/** Radio stream (live radio URL). */
export type RadioStream = {
  id: string;
  name: string;
  url: string;
  genre: string;
  cover: string | null;
  createdAt: string;
  /** Branch ownership. Legacy records may lack this; resolved as "default". */
  branchId?: string;
  /** Workspace/account ownership. */
  tenantId?: string;
};

/** Unified source for display - from playlist, db source, or radio. */
export type UnifiedSource = {
  id: string;
  /** Display title */
  title: string;
  /** Genre (from metadata or "Mixed") */
  genre: string;
  /** Cover/thumbnail URL */
  cover: string | null;
  /** Provider: youtube, soundcloud, spotify, local */
  type: SourceProviderType;
  /** Playback URL or target */
  url: string;
  /** Origin: from playlist store, db source, or radio */
  origin: "playlist" | "source" | "radio";
  /** View count (YouTube) – from stored data or fetched when displaying */
  viewCount?: number;
  /** Optional catalog row id (e.g. expanded playlist tracks with persisted catalog links). */
  catalogItemId?: string;
  /**
   * UI-only duration for expanded playlist track rows (`:track:`) — playback still uses parent `playlist` + index.
   */
  leafDurationSeconds?: number;
  /** Enriched catalog / snapshot fields (optional; batch-filled by unified API). */
  likeCount?: number;
  publishedAt?: string;
  /** SyncBiz CatalogItem.curationRating when linked. */
  curationRating?: number | null;
  /** Raw data for playback logic */
  playlist?: Playlist;
  source?: Source;
  radio?: RadioStream;
} & Partial<UnifiedSourceFoundation>;

/**
 * Unified list / playback id for a DB `Source` row. Store-generated ids are already `src-*`;
 * prefixing again yields `src-src-*` and breaks GET `/api/sources/[id]` and `?sourceId=` flows.
 */
export function unifiedLibraryIdForDbSourceId(dbSourceId: string): string {
  return dbSourceId.startsWith("src-") ? dbSourceId : `src-${dbSourceId}`;
}

/** Genre line when persisted value is empty — never use `type` (provider slug) as genre. */
export const LIBRARY_CARD_FALLBACK_GENRE = "Mixed";

export function libraryCardDisplayGenre(source: Pick<UnifiedSource, "genre">): string {
  const g = typeof source.genre === "string" ? source.genre.trim() : "";
  return g || LIBRARY_CARD_FALLBACK_GENRE;
}

export function libraryCardEffectiveViewCount(source: UnifiedSource): number | undefined {
  const v = source.viewCount ?? source.playlist?.viewCount;
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return v;
}

export function libraryCardEffectiveLikeCount(source: UnifiedSource): number | undefined {
  const v = source.likeCount ?? source.playlist?.likeCount;
  if (v == null || typeof v !== "number" || !Number.isFinite(v) || v < 0) return undefined;
  return v;
}

export function libraryCardEffectivePublishedAt(source: UnifiedSource): string | undefined {
  const p = source.publishedAt ?? source.playlist?.publishedAt;
  if (typeof p !== "string" || !p.trim()) return undefined;
  return p.trim();
}

export function libraryCardEffectiveCuration(source: UnifiedSource): number | null | undefined {
  const c = source.curationRating ?? source.playlist?.curationRating;
  if (c == null) return undefined;
  return c;
}

/**
 * Library card footer meta row: show when there is a real genre, view count, or duration-in-meta rule.
 * When shown, `libraryCardDisplayGenre` supplies the left label (fallback "Mixed"), not `source.type`.
 */
export function libraryCardShouldShowMetaRow(
  source: UnifiedSource,
  durationSec: number,
  hasCoverArt: boolean,
): boolean {
  const hasPersistedGenre = Boolean(typeof source.genre === "string" && source.genre.trim());
  const vc = libraryCardEffectiveViewCount(source);
  const showDurationInMeta = durationSec > 0 && !hasCoverArt;
  return hasPersistedGenre || vc != null || showDurationInMeta;
}

/** JSON shape from POST /api/sources/parse-url (includes optional foundation hints). */
export type ParseUrlJson = {
  title: string;
  cover: string | null;
  genre: string;
  type: string;
  isRadio: boolean;
  viewCount?: number;
  durationSeconds?: number;
  artist?: string;
  song?: string;
  /** Stage 6B: Library paste classifier (mirrors `classifyMusicUrlIngest`). */
  musicUrlIngest?: MusicUrlIngestClassification;
} & Partial<UnifiedSourceFoundation>;

/**
 * Deterministic hints for URL ingest (matches server parse-url; no I/O).
 * Delegates to `classifyResolveFoundation` — keep client and API aligned.
 */
export function parseUrlFoundationHints(params: {
  rawUrl: string;
  inferredType: string;
  isRadio: boolean;
  isShazam: boolean;
}): UnifiedSourceFoundation {
  return classifyResolveFoundation(params);
}

/** Foundation hints for unified list rows by origin (library API). */
export function unifiedFoundationHints(
  origin: "playlist" | "source" | "radio",
  type: SourceProviderType,
  url: string
): UnifiedSourceFoundation {
  const isRadio = origin === "radio";
  const inferred = type as string;
  return parseUrlFoundationHints({
    rawUrl: url,
    inferredType: inferred,
    isRadio,
    isShazam: false,
  });
}

/** Pick only foundation keys from a parse-url response or similar object. */
export function pickUnifiedFoundationFields(
  p: Record<string, unknown> | null | undefined
): Partial<UnifiedSourceFoundation> {
  if (!p) return {};
  const keys = [
    "contentNodeKind",
    "mediaKind",
    "executionTarget",
    "engineSelectionPolicy",
    "mixStrategyHint",
    "taxonomyTags",
    "executionAdapterId",
    "preferredEngineType",
  ] as const;
  const out: Partial<UnifiedSourceFoundation> = {};
  for (const k of keys) {
    if (k in p && p[k] !== undefined) {
      (out as Record<string, unknown>)[k] = p[k];
    }
  }
  return out;
}

/** JSON structure for stored sources (playlist format). */
export type StoredSourceJson = {
  title: string;
  genre: string;
  cover: string;
  type: string;
  url: string;
};

/**
 * Classify UnifiedSource into the locked Library model:
 * collections/containers vs media items.
 */
function playlistIsExternalShellUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    (u.includes("youtube.com") && u.includes("list=")) ||
    (u.includes("open.spotify.com") && (u.includes("/playlist/") || u.includes("/album/"))) ||
    (u.includes("soundcloud.com") && u.includes("/sets/"))
  );
}

function classifyLibraryLeafEntityContract(source: UnifiedSource): LibraryEntityContract {
  const fromKind = leafContractSubtypeFromContentNode(source);
  if (fromKind === "radio_stream") return { entityKind: "item", itemSubtype: "radio_stream" };
  if (fromKind === "ai_asset") return { entityKind: "item", itemSubtype: "ai_asset" };
  if (fromKind === "mix_set") return { entityKind: "item", itemSubtype: "mix_set" };

  if (shouldClassifyLeafUrlAsMixSet(source)) {
    return { entityKind: "item", itemSubtype: "mix_set" };
  }

  const kind = source.contentNodeKind;
  if (kind === "syncbiz_playlist") {
    return { entityKind: "collection", collectionSubtype: "syncbiz_playlist" };
  }
  if (kind === "external_playlist") {
    return { entityKind: "collection", collectionSubtype: "external_playlist" };
  }

  // A leaf with an explicit single-track node kind is always a media item — never a collection,
  // regardless of `origin`. This prevents single YouTube videos added via search (origin:"playlist",
  // contentNodeKind:"single_track") from being misclassified as syncbiz_playlist.
  if (kind === "single_track" || kind === "track") {
    return { entityKind: "item", itemSubtype: "single_track" };
  }

  const u = (source.url ?? "").toLowerCase();
  const isExternalPlaylist =
    (u.includes("youtube.com") && u.includes("list=")) ||
    (u.includes("open.spotify.com") && (u.includes("/playlist/") || u.includes("/album/"))) ||
    (u.includes("soundcloud.com") && u.includes("/sets/"));
  if (isExternalPlaylist) {
    return { entityKind: "collection", collectionSubtype: "external_playlist" };
  }
  if (source.origin === "playlist" && source.playlist?.libraryPlacement === "ready_external") {
    return { entityKind: "collection", collectionSubtype: "external_playlist" };
  }
  return { entityKind: "item", itemSubtype: "single_track" };
}

export function classifyLibraryEntityContract(source: UnifiedSource): LibraryEntityContract {
  if (
    source.origin === "playlist" &&
    source.playlist &&
    source.playlist.libraryPlacement !== "ready_external"
  ) {
    if (playlistIsExternalShellUrl(source.url ?? "")) {
      return { entityKind: "collection", collectionSubtype: "external_playlist" };
    }
    // A user-created container playlist (local://user-playlist/…) is ALWAYS a
    // collection — even empty or with a single track. Otherwise a freshly made
    // playlist (0 tracks) was misclassified as a single leaf and landed in
    // "Single Tracks" instead of "Your Playlists".
    if ((source.url ?? "").startsWith("local://user-playlist/")) {
      return { entityKind: "collection", collectionSubtype: "syncbiz_playlist" };
    }
    const trackCount = getPlaylistTracks(source.playlist).length;
    if (trackCount <= 1) {
      return classifyLibraryLeafEntityContract(source);
    }
    return { entityKind: "collection", collectionSubtype: "syncbiz_playlist" };
  }

  const kind = source.contentNodeKind;
  if (kind === "syncbiz_playlist") {
    return { entityKind: "collection", collectionSubtype: "syncbiz_playlist" };
  }
  if (kind === "external_playlist") {
    return { entityKind: "collection", collectionSubtype: "external_playlist" };
  }
  if (kind === "mix_set") {
    return classifyLibraryLeafEntityContract(source);
  }
  if (kind === "radio_stream" || source.origin === "radio") {
    return { entityKind: "item", itemSubtype: "radio_stream" };
  }
  if (kind === "ai_asset") {
    return { entityKind: "item", itemSubtype: "ai_asset" };
  }
  if (kind === "single_track" || kind === "track") {
    return classifyLibraryLeafEntityContract(source);
  }

  // Stable fallback rules for legacy rows.
  const u = (source.url ?? "").toLowerCase();
  const isExternalPlaylist =
    (u.includes("youtube.com") && u.includes("list=")) ||
    (u.includes("open.spotify.com") && (u.includes("/playlist/") || u.includes("/album/"))) ||
    (u.includes("soundcloud.com") && u.includes("/sets/"));
  if (isExternalPlaylist) {
    return { entityKind: "collection", collectionSubtype: "external_playlist" };
  }
  if (source.origin === "playlist" && source.playlist?.libraryPlacement === "ready_external") {
    return { entityKind: "collection", collectionSubtype: "external_playlist" };
  }
  return classifyLibraryLeafEntityContract(source);
}
