/**
 * Shared read-only types for Music Discovery (Search + DJ Creator convergence).
 * Phase 1: contracts + orchestration only — no Music Bank, no UI wiring required.
 */

import type { ExternalSearchResults } from "@/lib/search-service";
import type { UnifiedSource } from "@/lib/source-types";

/** Reserved for future indexed local bank; orchestrator must not emit this in Phase 1. */
export type MusicDiscoveryCandidateOrigin =
  | "workspace_playlist"
  | "workspace_source"
  | "radio"
  | "syncbiz_catalog"
  | "ready_pack"
  | "external_web"
  | "music_bank_local";

export type MusicDiscoveryIntent =
  | "keyword"
  | "catalog_smart"
  | "dj_creator_matrix"
  | "unknown";

/**
 * Tenant/workspace scope metadata for callers and future providers.
 * Phase 1 orchestrator does not fetch by scope — callers supply scoped `unifiedSources`.
 */
export type MusicDiscoveryScope = {
  workspaceId?: string;
  branchId?: string;
};

export type MusicDiscoveryQuery = {
  rawText: string;
  scope?: MusicDiscoveryScope;
  intent?: MusicDiscoveryIntent;
  filters?: {
    genre?: string;
    daypart?: string;
    avoidTaxonomySlugs?: string[];
    djMatrixKey?: string | null;
  };
};

export type MusicDiscoverySignals = {
  curationRating?: number | null;
  viewCount?: number | null;
  likeCount?: number | null;
  playCount?: number | null;
  matchedTokens?: string[];
};

export type MusicDiscoveryCandidate = {
  origin: MusicDiscoveryCandidateOrigin;
  /** Stable merge key — globally unique per logical hit for deduplication */
  dedupeKey: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string | null;
  /** Playback or resolve target when applicable (may include device-local paths for workspace playlists). */
  playbackUrl?: string;
  catalogItemId?: string;
  playlistId?: string;
  trackId?: string;
  unifiedSourceId?: string;
  score?: number;
  signals?: MusicDiscoverySignals;
};

export type MusicDiscoveryProviderRunMeta = {
  providerId: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  candidateCount: number;
};

export type MusicDiscoveryRunOptions = {
  /** Wall-clock timeout per provider (external fetch). Default 12s. */
  providerTimeoutMs?: number;
  /** Max candidates kept per origin after merge (before totalCap). Default 25 each. */
  maxPerOrigin?: number;
  /** Hard cap on returned candidates. Default 80. */
  totalCap?: number;
  includeWorkspace?: boolean;
  includeExternal?: boolean;
};

export type MusicDiscoveryDeps = {
  /**
   * Mirrors `searchExternal` in `lib/search-service.ts` — browser-relative `/api/*` fetch.
   * Inject in tests or server contexts with absolute URLs.
   */
  searchExternal?: (query: string, genreFilter?: string) => Promise<ExternalSearchResults>;
};

export type MusicDiscoveryInput = {
  query: MusicDiscoveryQuery;
  /** Required — caller loads tenant-scoped rows (e.g. GET /api/sources/unified). */
  unifiedSources: UnifiedSource[];
  deps?: MusicDiscoveryDeps;
  options?: MusicDiscoveryRunOptions;
};

export type MusicDiscoveryResult = {
  candidates: MusicDiscoveryCandidate[];
  providerRuns: MusicDiscoveryProviderRunMeta[];
};

/**
 * Pluggable provider contract for Phase 2+ (smart catalog, Music Bank snapshot, etc.).
 */
export interface MusicDiscoveryProvider {
  readonly id: string;
  discover(input: MusicDiscoveryProviderInput): Promise<MusicDiscoveryCandidate[]>;
}

export type MusicDiscoveryProviderInput = {
  query: MusicDiscoveryQuery;
  unifiedSources: UnifiedSource[];
  options: MusicDiscoveryRunOptions & {
    providerTimeoutMs: number;
    maxPerOrigin: number;
    totalCap: number;
    includeWorkspace: boolean;
    includeExternal: boolean;
  };
  deps?: MusicDiscoveryDeps;
};
