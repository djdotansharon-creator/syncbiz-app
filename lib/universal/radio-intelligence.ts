/**
 * Phase B0.4 — Radio & Official-Chart CONTRACTS ONLY.
 *
 * Interfaces for radio airplay, station editorial/rotation playlists, and official
 * charts. NONE are implemented and NO ingestion/scraping happens here. Charts
 * (Galgalatz, Official UK, Shazam, Apple Music) populate ChartSnapshot/ChartEntry;
 * non-chart radio signal populates RadioStation / RadioAirplayEvent /
 * StationPlaylistSnapshot / StationPlaylistEntry. This file is the typed seam a later
 * "B1 — Charts & Radio" stage will implement behind real, authorized data sources.
 */

import type { ChartSnapshotData, ChartTypeName } from "@/lib/universal/music-intelligence";

/** A station as a provider reports it (pre-persistence to RadioStation). */
export interface StationRef {
  name: string;
  country: string;
  city?: string;
  market?: string;
  stationFormat?: string;
  externalIds?: Record<string, string>;
}

export interface AirplayObservation {
  station: StationRef;
  playedAt: string; // ISO 8601
  rawTitle: string;
  rawArtists: string[];
  rawIsrc?: string;
  source: string;
}

export type StationPlaylistTierName = "EDITORIAL" | "A_LIST" | "B_LIST" | "C_LIST" | "ROTATION";

export interface StationPlaylistData {
  station: StationRef;
  playlistType: StationPlaylistTierName;
  capturedAt: string; // ISO 8601
  sourceReference?: string;
  entries: Array<{
    rawTitle: string;
    rawArtists: string[];
    position?: number;
    rotationLevel?: string;
    addedAt?: string;
  }>;
}

// ── Provider contracts (no implementations) ─────────────────────────────────

/** Official singles/album charts (the authoritative chart body itself). */
export interface OfficialChartProvider {
  readonly id: string;
  readonly supportedChartTypes: readonly ChartTypeName[];
  fetchOfficialChart(input: { chartType: ChartTypeName; territory?: string; genre?: string }): Promise<ChartSnapshotData>;
}

/** Per-station spin/airplay logs. */
export interface RadioAirplayProvider {
  readonly id: string;
  fetchAirplay(input: { territory?: string; stationId?: string; since?: string }): Promise<AirplayObservation[]>;
}

/** Editorial / A-B-C rotation playlists for a station. */
export interface StationPlaylistProvider {
  readonly id: string;
  fetchStationPlaylists(input: { stationId?: string; territory?: string }): Promise<StationPlaylistData[]>;
}

/** Umbrella that a full radio-intelligence source may implement across the above. */
export interface RadioIntelligenceProvider {
  readonly id: string;
  readonly capabilities: {
    officialCharts: boolean;
    airplay: boolean;
    stationPlaylists: boolean;
  };
}

// ── Planned providers (documentation only — NOT implemented, NOT scheduled) ──

export interface PlannedRadioProvider {
  id: string;
  status: "planned";
  provides: Array<"official_chart" | "chart" | "airplay" | "station_playlist">;
  integration: "official_api" | "authorized_feed" | "licensed_partner" | "manual_csv_pilot";
  notes: string;
}

/**
 * Intended B1 sources. Declaration only — no active ingestion, no scraping. Charts land
 * in ChartSnapshot/ChartEntry; airplay/editorial land in the Radio* tables.
 */
export const PLANNED_RADIO_PROVIDERS: readonly PlannedRadioProvider[] = [
  {
    id: "apple_music_charts",
    status: "planned",
    provides: ["chart"],
    integration: "official_api",
    notes: "Apple Music official charts by country/storefront + genre.",
  },
  {
    id: "shazam_charts",
    status: "planned",
    provides: ["chart"],
    integration: "manual_csv_pilot",
    notes: "Top 200 / Viral / Discovery by country/city/genre. Pilot = manual CSV/admin import; production = licensed feed/direct partnership. No scraping.",
  },
  {
    id: "galgalatz",
    status: "planned",
    provides: ["chart", "station_playlist"],
    integration: "manual_csv_pilot",
    notes: "Israeli weekly chart + international weekly chart + editorial playlist. Pilot = controlled admin import; production = authorized feed/partnership. No automatic scraping.",
  },
  {
    id: "official_uk_singles",
    status: "planned",
    provides: ["official_chart"],
    integration: "authorized_feed",
    notes: "The Official UK Singles Chart is the authoritative chart source. BBC Radio 1 is a BROADCASTER, not the chart owner; Radio 1 editorial/A/B/C playlists are a SEPARATE station-playlist signal, not this chart.",
  },
  {
    id: "global_radio",
    status: "planned",
    provides: ["airplay", "station_playlist"],
    integration: "licensed_partner",
    notes: "Soundcharts / Radiomonitor / Chartmetric — airplay events, spin counts, station & territory coverage. Commercial licensing required.",
  },
] as const;
