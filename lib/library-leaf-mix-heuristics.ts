/**
 * Shared leaf URL mix/set heuristics — used by library grouping, entity contracts, and badges.
 */

import { getYouTubePlaylistId, isYouTubeMixUrl } from "@/lib/playlist-utils";
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
  const d = source.playlist?.durationSeconds;
  return typeof d === "number" && d > 0 ? d : null;
}

/**
 * Leaf SET rules:
 * - Under 10m: SET only for explicit YouTube mix/RD URLs.
 * - 10m–20m: SET only if explicit mix URL or strong long-form title cue.
 * - 20m+: usually SET (long-form).
 * - Unknown duration: explicit mix URL or strong cue only (not bare "mix" / foundation flags alone).
 */
export function shouldClassifyLeafUrlAsMixSet(source: UnifiedSource): boolean {
  if (source.contentNodeKind === "syncbiz_playlist") return false;

  const url = source.url?.trim() ?? "";
  const explicitMix = isExplicitLeafMixStyleUrl(url);
  const durationSeconds = durationFromUnified(source);

  if (durationSeconds != null) {
    if (durationSeconds < 10 * 60) {
      return explicitMix;
    }
    if (durationSeconds >= 20 * 60) {
      return true;
    }
    return explicitMix || strongLongFormTitleCue(source.title);
  }

  if (explicitMix) return true;
  return strongLongFormTitleCue(source.title);
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
