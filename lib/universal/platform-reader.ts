/**
 * Phase A2 — the unified PlatformReader abstraction.
 *
 * Every music platform is read through this one interface. A reader only DECLARES
 * the capabilities it can honestly back today; the registry never invents support.
 * Readers delegate to the existing, verified functions in the codebase — they add
 * an abstraction seam, they do NOT change playback, the Queue, Transport, or MASTER.
 *
 * Nothing here is wired into the UI yet (that is Phase A3). These modules are the
 * contract + honest capability declarations that the Universal Import screen will
 * later consume.
 */

import type { MusicStreamingProvider } from "@/lib/source-types";
import type { NormalizedCollection, NormalizedTrack } from "@/lib/universal/universal-track";

/** What a reader can actually do today. `false` = genuinely unsupported (no facade). */
export interface ReaderCapabilities {
  detect: boolean;
  readPlaylist: boolean;
  readAlbum: boolean;
  readTrack: boolean;
  /** Whether SyncBiz can play this platform's audio directly (vs resolve-to-YouTube). */
  nativePlayback: boolean;
  /** Honest one-line note about the real limits of this reader. */
  note?: string;
}

export type DetectedItemKind = "track" | "playlist" | "album" | "mix" | "unknown";

export interface PlatformDetection {
  provider: MusicStreamingProvider;
  kind: DetectedItemKind;
  /**
   * Whether the CURRENT readers can actually turn this URL into normalized tracks.
   * `false` for e.g. an Apple/Deezer/TIDAL/Amazon album — recognized, but no real
   * reader exists, so the UI must show "recognized, not supported yet" (never a fake).
   */
  supported: boolean;
}

export interface PlatformReader {
  /** Stable id, e.g. "youtube" | "spotify" | "m3u" | "soundcloud". */
  readonly id: string;
  readonly capabilities: ReaderCapabilities;

  /** Cheap, synchronous URL classification. Returns null if this reader doesn't own the URL. */
  detect(url: string): PlatformDetection | null;

  /** Present only when capabilities.readPlaylist is true. */
  readPlaylist?(url: string): Promise<NormalizedCollection>;
  /** Present only when capabilities.readAlbum is true. */
  readAlbum?(url: string): Promise<NormalizedCollection>;
  /** Present only when capabilities.readTrack is true. */
  readTrack?(url: string): Promise<NormalizedTrack>;

  /** Map a raw provider payload into a NormalizedTrack (used internally by the read* methods). */
  normalize(raw: unknown): NormalizedTrack;
}

/**
 * The active reader registry. Populated lazily to avoid importing server-only
 * modules (yt-dlp / child_process) into any bundle before a reader is actually used.
 * Import the individual reader modules to register; kept as functions so callers
 * choose when to pull the heavy dependencies.
 */
export const PLATFORM_READERS: PlatformReader[] = [];

export function registerPlatformReader(reader: PlatformReader): void {
  if (!PLATFORM_READERS.some((r) => r.id === reader.id)) PLATFORM_READERS.push(reader);
}

/** First reader whose detect() claims the URL. */
export function readerForUrl(url: string): { reader: PlatformReader; detection: PlatformDetection } | null {
  for (const reader of PLATFORM_READERS) {
    const detection = reader.detect(url);
    if (detection) return { reader, detection };
  }
  return null;
}
