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

export type SourceProviderType = "youtube" | "soundcloud" | "spotify" | "local" | "stream-url" | "winamp";

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
  /** Raw data for playback logic */
  playlist?: Playlist;
  source?: Source;
  radio?: RadioStream;
} & Partial<UnifiedSourceFoundation>;

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
export function classifyLibraryEntityContract(source: UnifiedSource): LibraryEntityContract {
  const kind = source.contentNodeKind;
  if (kind === "syncbiz_playlist") {
    return { entityKind: "collection", collectionSubtype: "syncbiz_playlist" };
  }
  if (kind === "external_playlist") {
    return { entityKind: "collection", collectionSubtype: "external_playlist" };
  }
  if (kind === "mix_set") {
    return { entityKind: "item", itemSubtype: "mix_set" };
  }
  if (kind === "radio_stream" || source.origin === "radio") {
    return { entityKind: "item", itemSubtype: "radio_stream" };
  }
  if (kind === "ai_asset") {
    return { entityKind: "item", itemSubtype: "ai_asset" };
  }
  if (kind === "single_track" || kind === "track") {
    return { entityKind: "item", itemSubtype: "single_track" };
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
  if (source.origin === "playlist") {
    return { entityKind: "collection", collectionSubtype: "syncbiz_playlist" };
  }
  return { entityKind: "item", itemSubtype: "single_track" };
}
