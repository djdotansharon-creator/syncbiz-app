/**
 * Unified Source type for the Sources library view.
 * Normalizes Playlist and db Source into a single display format.
 */

import type { Playlist } from "./playlist-types";
import type { Source } from "./types";

export type SourceProviderType = "youtube" | "soundcloud" | "spotify" | "local" | "stream-url" | "winamp";

/** Radio stream (live radio URL). */
export type RadioStream = {
  id: string;
  name: string;
  url: string;
  genre: string;
  cover: string | null;
  createdAt: string;
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
};

/** JSON structure for stored sources (playlist format). */
export type StoredSourceJson = {
  title: string;
  genre: string;
  cover: string;
  type: string;
  url: string;
};
