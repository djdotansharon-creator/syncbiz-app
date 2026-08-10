/**
 * Phase A2 — Discovery / Charts / Music-Intelligence CONTRACTS ONLY.
 *
 * These interfaces separate the four concerns the audit flagged: Discovery (what to
 * play), Music Intelligence (charts/popularity/trend), Catalog Resolver (identity →
 * playable), and Playback (choose a source). NONE of them are implemented here and
 * NO ingestion happens — this file is the typed seam that a later "Charts & Music
 * Intelligence" stage will implement behind real, licensed data sources.
 *
 * Volatile signals (rank/popularity/trend) are represented per source/territory/date,
 * matching the ChartSnapshot / ChartEntry / TrendSignal tables — never flattened onto
 * a track's identity.
 */

import type { NormalizedTrack, UniversalProvider } from "@/lib/universal/universal-track";

/** Mirrors the Prisma `ChartType` enum. */
export type ChartTypeName = "TOP" | "VIRAL" | "DISCOVERY" | "GENRE" | "CITY";

// ── Charts ──────────────────────────────────────────────────────────────────

export interface ChartQuery {
  chartType: ChartTypeName;
  /** ISO-3166 alpha-2; omit for global. */
  territory?: string;
  city?: string;
  genre?: string;
  limit?: number;
}

export interface ChartEntryData {
  rank: number;
  previousRank?: number;
  peakRank?: number;
  daysOnChart?: number;
  /** Provider-native id, matched to a UniversalTrack later. */
  providerExternalId?: string;
  /** Best-effort identity the provider gives us (title/artist), pre-match. */
  title?: string;
  artist?: string;
  // Rich optional metadata (populated by providers that return full track detail).
  isrc?: string;
  album?: string;
  releaseDate?: string;
  durationMs?: number;
  artworkUrl?: string;
  genre?: string;
}

export interface ChartSnapshotData {
  source: string;
  chartType: ChartTypeName;
  territory?: string;
  city?: string;
  genre?: string;
  capturedAt: string; // ISO 8601
  entries: ChartEntryData[];
}

/** A provider of ranked charts (Apple Music, Shazam, YouTube Trending, …). */
export interface ChartProvider {
  readonly id: string;
  readonly supportedChartTypes: readonly ChartTypeName[];
  fetchChart(query: ChartQuery): Promise<ChartSnapshotData>;
}

// ── Music Intelligence (popularity / trend lookups) ──────────────────────────

export interface TrendObservation {
  source: string;
  territory?: string;
  city?: string;
  signalType: string; // velocity | spike | shazam_count | views_delta | …
  value: number;
  observedAt: string; // ISO 8601
}

export interface MusicIntelligenceProvider {
  readonly id: string;
  /** Popularity/trend for an already-identified track (0..1 normalized where possible). */
  getTrendSignals(input: { isrc?: string; title: string; artist?: string; territory?: string }): Promise<TrendObservation[]>;
}

// ── Discovery (what should play) ─────────────────────────────────────────────

export interface DiscoveryRequest {
  businessType?: string;
  daypart?: string;
  territory?: string;
  city?: string;
  genres?: string[];
  vibe?: string;
  /** 0..1 — bias toward recent releases. */
  freshness?: number;
  /** 0..1 — bias toward popular/charting tracks. */
  popularity?: number;
  limit: number;
}

export interface RankedTrackCandidate {
  track: NormalizedTrack;
  /** 0..1 fit score. */
  score: number;
  /** Human-readable reasons (for transparency in the DJ Creator UI). */
  reasons: string[];
  /** Where the candidate came from (catalog, chart, external search, …). */
  source: string;
  /** Providers on which the track is known to exist. */
  availableOn?: UniversalProvider[];
}

export interface DiscoveryProvider {
  readonly id: string;
  discover(request: DiscoveryRequest): Promise<RankedTrackCandidate[]>;
}

// ── Planned providers (documentation only — NOT implemented, NOT scheduled here) ──

export interface PlannedProvider {
  id: string;
  kind: "chart" | "intelligence" | "discovery";
  status: "planned";
  integration: "official_api" | "licensed_partner" | "manual_csv_pilot";
  notes: string;
}

/**
 * The intended next-stage data sources. This is a declaration for the roadmap, NOT a
 * registry of active providers. No scraping is planned or permitted; Shazam charts
 * require a manual CSV for the pilot and a licensed partner for production.
 */
export const PLANNED_MUSIC_INTELLIGENCE_PROVIDERS: readonly PlannedProvider[] = [
  {
    id: "apple_music_charts",
    kind: "chart",
    status: "planned",
    integration: "official_api",
    notes: "Apple Music official charts API — top by territory/genre.",
  },
  {
    id: "shazam_charts",
    kind: "chart",
    status: "planned",
    integration: "manual_csv_pilot",
    notes: "Top 200 / Viral / Discovery / Country / City / Genre. Pilot = manual CSV; production = licensed partner/direct. No scraping.",
  },
  {
    id: "youtube_trending",
    kind: "chart",
    status: "planned",
    integration: "official_api",
    notes: "YouTube trending/most-popular by region via the Data API.",
  },
  {
    id: "soundcharts",
    kind: "intelligence",
    status: "planned",
    integration: "licensed_partner",
    notes: "Cross-platform popularity/trend metrics. Alternative: Chartmetric.",
  },
] as const;
