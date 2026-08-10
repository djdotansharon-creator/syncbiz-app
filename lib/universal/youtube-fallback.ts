/**
 * Phase C hardening — safe Spotify-only → YouTube fallback.
 *
 * Reuses the EXISTING conservative M3U→YouTube scorer (narrowYoutubeCandidatesForM3uRow +
 * isSafeAutoPick), which already drops Live/Cover/Karaoke/Remix/wrong-version candidates and
 * requires a clear margin. Candidates are INJECTED (a real yt-dlp search in production, a
 * fixture in tests) so this stays pure/testable and never guesses a wrong edit.
 */

import type { YouTubeSearchResult } from "@/lib/search-service";
import type { M3uUnresolvedImportRow } from "@/lib/m3u-youtube-resolve-shared";
import { isSafeAutoPick, narrowYoutubeCandidatesForM3uRow } from "@/lib/m3u-youtube-bulk-confidence";
import { getYouTubeVideoId } from "@/lib/playlist-utils";

export interface FallbackRow {
  title: string;
  artist?: string;
  durationSec?: number;
}

/** A source of YouTube candidates for a query (real search in prod, fixture in tests). */
export type YouTubeCandidateProvider = (query: string, row: FallbackRow) => Promise<YouTubeSearchResult[]>;

/** Returns a SAFE YouTube pick for a track, or null if nothing is confidently correct. */
export function pickSafeYouTubeVideoId(row: FallbackRow, candidates: YouTubeSearchResult[]): { videoId: string; url: string } | null {
  const query = [row.artist, row.title].filter(Boolean).join(" ").trim() || (row.title ?? "");
  const m3uRow: M3uUnresolvedImportRow = {
    ref: "",
    reason: "spotify_only_fallback",
    playlistOrder: 0,
    displayTitle: row.title ?? null,
    durationSec: row.durationSec ?? null,
    suggestedSearchQuery: query,
  };
  const { display } = narrowYoutubeCandidatesForM3uRow(m3uRow, candidates);
  if (!isSafeAutoPick(m3uRow, display)) return null;
  const best = display[0];
  const videoId = best ? getYouTubeVideoId(best.url) : null;
  return videoId ? { videoId, url: best.url } : null;
}
