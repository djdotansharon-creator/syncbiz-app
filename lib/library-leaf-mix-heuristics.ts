/**
 * Shared leaf URL mix/set heuristics — used by library grouping, entity contracts, and badges.
 */

import { getYouTubePlaylistId, isYouTubeMixUrl } from "@/lib/playlist-utils";
import { getPlaylistTracks } from "@/lib/playlist-types";
import type { ContentNodeKind } from "@/lib/types";
import type { UnifiedSource } from "@/lib/source-types";

/** YouTube mix / radio-style continuation URL — strong SET signal regardless of duration. */
export function isExplicitLeafMixStyleUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  const lower = u.toLowerCase();
  if (!lower.includes("youtube.com") && !lower.includes("youtu.be")) return false;
  const listId = getYouTubePlaylistId(u);
  if (listId && /^RD/i.test(listId)) return true;
  return isYouTubeMixUrl(u);
}

function mapUrlToSectionHint(url: string): "external_playlists" | "mix_set" | "single_tracks" | null {
  const u = url.trim();
  if (!u) return null;
  const lower = u.toLowerCase();

  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    const listId = getYouTubePlaylistId(u);
    if (listId) {
      if (listId.startsWith("PL")) return "external_playlists";
      if (listId.startsWith("RD") || isYouTubeMixUrl(u)) return "mix_set";
      return "external_playlists";
    }
    return "single_tracks";
  }

  if (lower.includes("spotify.com") || lower.includes("open.spotify.com")) {
    if (/\/playlist\//i.test(u) || /\/album\//i.test(u)) return "external_playlists";
    if (/\/track\//i.test(u) || /\/episode\//i.test(u)) return "single_tracks";
    return null;
  }

  if (lower.includes("soundcloud.com")) {
    if (/\/sets\//i.test(u)) return "external_playlists";
    return "single_tracks";
  }

  return null;
}

/**
 * Strong long-form indicators only (10–20 min band, or unknown duration).
 * Does NOT match bare "mix", "remix", "original mix", "extended mix", "radio edit", or generic "session" in short titles.
 */
export function strongLongFormTitleCue(title: string | undefined | null): boolean {
  const t = (title ?? "").toLowerCase();
  if (!t) return false;

  const needles = [
    "dj set",
    "live set",
    "full set",
    "mixtape",
    "continuous mix",
    "podcast",
    "radio show",
    "boiler room",
    "boilerroom",
    "essential mix",
    "hour mix",
  ];
  for (const n of needles) {
    if (t.includes(n)) return true;
  }

  if (/\b(session)\b/.test(t)) {
    if (/\b(remix|radio edit|original mix|extended mix)\b/.test(t)) return false;
    return true;
  }

  return false;
}

function durationFromUnified(source: UnifiedSource): number | null {
  if (typeof source.leafDurationSeconds === "number" && source.leafDurationSeconds > 0) {
    return source.leafDurationSeconds;
  }
  // playlist.durationSeconds is the TOTAL of the container. It only equals this
  // leaf's duration for single-URL shells; for a track inside a multi-track
  // playlist it is the whole playlist's length and classified every 4-minute
  // song as a 15-minute SET (operator-reported). Unknown stays unknown.
  const pl = source.playlist;
  if (!pl) return null;
  if (getPlaylistTracks(pl).length > 1) return null;
  const d = pl.durationSeconds;
  return typeof d === "number" && d > 0 ? d : null;
}

/** SET threshold — a leaf is a SET only when it runs longer than this. */
export const MIX_SET_MIN_DURATION_SECONDS = 15 * 60;

/**
 * Leaf SET rule (simple, duration-driven):
 * - Known duration: SET iff it is over 15 minutes. Titles/keywords never override this.
 * - Unknown duration: SET only for explicit YouTube mix/RD URLs (endless radio-style mixes);
 *   everything else stays SINGLE.
 */
export function shouldClassifyLeafUrlAsMixSet(source: UnifiedSource): boolean {
  if (source.contentNodeKind === "syncbiz_playlist") return false;

  const durationSeconds = durationFromUnified(source);
  if (durationSeconds != null) {
    return durationSeconds >= MIX_SET_MIN_DURATION_SECONDS;
  }

  return isExplicitLeafMixStyleUrl(source.url?.trim() ?? "");
}

/** Map contentNodeKind — mix_set is resolved only via shouldClassifyLeafUrlAsMixSet, not here. */
export function leafContractSubtypeFromContentNode(
  source: UnifiedSource,
): "mix_set" | "single_track" | "radio_stream" | "ai_asset" | null {
  const kind = source.contentNodeKind as ContentNodeKind | undefined;
  if (kind === "radio_stream" || source.origin === "radio") return "radio_stream";
  if (kind === "ai_asset") return "ai_asset";
  if (kind === "single_track" || kind === "track") return null;
  if (kind === "mix_set") return null;
  return null;
}
