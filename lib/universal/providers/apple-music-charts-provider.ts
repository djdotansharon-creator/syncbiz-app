/**
 * Phase B1 — AppleMusicChartsProvider (fixture mode).
 *
 * Implements ChartProvider. In FIXTURE mode it reads a locally-saved sample payload
 * (Apple's response shape) — NO network, NO credentials. LIVE mode is intentionally
 * NOT implemented: it throws, because a real call needs an Apple Developer Token
 * (JWT ES256 signed with a MusicKit .p8 private key). No scraping, no undocumented
 * API, no fabricated credentials, no production/user tokens.
 *
 * Official endpoint (for when credentials exist):
 *   GET https://api.music.apple.com/v1/catalog/{storefront}/charts?types=songs&chart=most-played&limit=N
 *   Header: Authorization: Bearer <developer-token>
 */

import fs from "node:fs";
import type { ChartProvider, ChartQuery, ChartSnapshotData, ChartTypeName } from "@/lib/universal/music-intelligence";
import { parseAppleCharts, type AppleChartsPayload } from "@/lib/universal/providers/apple-music-parser";

export interface AppleProviderConfig {
  /** Path to a local Apple charts JSON fixture. Required in fixture mode. */
  fixturePath?: string;
  /** When true, a live API call would be made — NOT implemented (needs credentials). */
  live?: boolean;
  /** Default storefront (country) if the query omits territory. */
  storefront?: string;
  providerVersion?: string;
}

export const APPLE_MUSIC_PROVIDER_VERSION = "apple-charts-fixture-1";

export class AppleMusicChartsProvider implements ChartProvider {
  readonly id = "apple_music";
  readonly supportedChartTypes: readonly ChartTypeName[] = ["TOP"];

  constructor(private readonly config: AppleProviderConfig) {}

  /** The raw fixture payload (for deterministic sourcePayloadHash). Fixture mode only. */
  loadRawPayloadString(): string {
    if (!this.config.fixturePath) throw new Error("fixturePath is required in fixture mode");
    return fs.readFileSync(this.config.fixturePath, "utf8");
  }

  async fetchChart(query: ChartQuery): Promise<ChartSnapshotData> {
    if (this.config.live) {
      throw new Error(
        "AppleMusicChartsProvider LIVE mode is not enabled: a real request requires an Apple " +
          "Developer Token (JWT ES256 from a MusicKit .p8 key). Use fixture mode until credentials exist.",
      );
    }
    const payload = JSON.parse(this.loadRawPayloadString()) as AppleChartsPayload;
    return parseAppleCharts(payload, {
      territory: query.territory ?? this.config.storefront ?? "us",
      chartType: query.chartType,
    });
  }
}
