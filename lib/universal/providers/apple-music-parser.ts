/**
 * Phase B1 — Apple Music "Get Catalog Charts" payload parser.
 *
 * Maps the official response shape (GET https://api.music.apple.com/v1/catalog/
 * {storefront}/charts?types=songs&chart=most-played) into our provider-agnostic
 * ChartSnapshotData. Rank is the 1-based position within the chart's `data[]`.
 * Pure: no network, no DB. Works identically on a live response or a local fixture.
 */

import type { ChartEntryData, ChartSnapshotData, ChartTypeName } from "@/lib/universal/music-intelligence";

interface AppleArtwork {
  url?: string;
  width?: number;
  height?: number;
}
interface AppleSongAttributes {
  name?: string;
  artistName?: string;
  albumName?: string;
  isrc?: string;
  releaseDate?: string;
  durationInMillis?: number;
  genreNames?: string[];
  artwork?: AppleArtwork;
  url?: string;
}
interface AppleSong {
  id?: string;
  type?: string;
  attributes?: AppleSongAttributes;
}
interface AppleChart {
  chart?: string;
  name?: string;
  data?: AppleSong[];
}
export interface AppleChartsPayload {
  results?: { songs?: AppleChart[] };
}

/** Fill Apple's {w}x{h} artwork URL template at a fixed size. */
function artworkUrl(a: AppleArtwork | undefined, size = 600): string | undefined {
  if (!a?.url) return undefined;
  return a.url.replace("{w}", String(size)).replace("{h}", String(size));
}

export interface AppleParseOptions {
  territory: string;
  chartType: ChartTypeName;
  /** Which chart array to read (Apple returns songs/albums/... arrays). */
  chartIndex?: number;
}

/** Parse an Apple charts payload into one ChartSnapshotData (songs chart). */
export function parseAppleCharts(payload: AppleChartsPayload, opts: AppleParseOptions): ChartSnapshotData {
  const songsCharts = payload.results?.songs ?? [];
  const chart = songsCharts[opts.chartIndex ?? 0];
  const data = chart?.data ?? [];

  const entries: ChartEntryData[] = data.map((song, idx) => {
    const a = song.attributes ?? {};
    return {
      rank: idx + 1,
      providerExternalId: song.id,
      title: a.name,
      artist: a.artistName,
      isrc: a.isrc,
      album: a.albumName,
      releaseDate: a.releaseDate,
      durationMs: typeof a.durationInMillis === "number" ? a.durationInMillis : undefined,
      artworkUrl: artworkUrl(a.artwork),
      genre: a.genreNames?.[0],
    };
  });

  return {
    source: "apple_music",
    chartType: opts.chartType,
    territory: opts.territory,
    genre: undefined,
    capturedAt: new Date(0).toISOString(), // caller overrides with a real capturedAt (Date is injected)
    entries,
  };
}
