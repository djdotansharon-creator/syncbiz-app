/**
 * Visual library sections for /sources — deterministic, uses UnifiedSource + URL heuristics only.
 */

import { getYouTubePlaylistId, isYouTubeMixUrl } from "@/lib/playlist-utils";
import type { ContentNodeKind } from "@/lib/types";
import type { UnifiedSource } from "@/lib/source-types";

export type LibrarySectionId =
  | "syncbiz_playlists"
  | "mix_set"
  | "external_playlists"
  | "single_tracks"
  | "other";

export const LIBRARY_SECTION_ORDER: LibrarySectionId[] = [
  "syncbiz_playlists",
  "mix_set",
  "external_playlists",
  "single_tracks",
  "other",
];

export const LIBRARY_SECTION_LABELS: Record<LibrarySectionId, string> = {
  syncbiz_playlists: "SyncBiz Playlists",
  mix_set: "Mix / Set",
  external_playlists: "External Playlists",
  single_tracks: "Single Tracks",
  other: "Other / Uncategorized",
};

function mapKindToSection(kind: ContentNodeKind): LibrarySectionId | null {
  switch (kind) {
    case "syncbiz_playlist":
      return "syncbiz_playlists";
    case "mix_set":
      return "mix_set";
    case "external_playlist":
      return "external_playlists";
    case "single_track":
    case "track":
      return "single_tracks";
    case "radio_stream":
    case "ai_asset":
      return "other";
    case "unknown":
      return null;
    default:
      return null;
  }
}

function classifyByUrl(url: string): LibrarySectionId | null {
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

function titleHasMixSetCue(title: string | undefined | null): boolean {
  const t = (title ?? "").toLowerCase();
  if (!t) return false;
  // Title cues: mix / set / live set / full set / session
  return (
    /\b(mix|set|session)\b/.test(t) ||
    /\blive\s+set\b/.test(t) ||
    /\bfull\s+set\b/.test(t)
  );
}

function getDurationSeconds(source: UnifiedSource): number | null {
  const d = source.playlist?.durationSeconds;
  return typeof d === "number" && d > 0 ? d : null;
}

/**
 * Product rule: `mix_set` auto-classification from duration (YouTube only).
 *
 * - >= 20 minutes: strong candidate, but not plain long singles (no list=, no mix title cues).
 * - 15–20 minutes: hint only — needs title mix/set cues or URL mix heuristics (RD / start_radio).
 * - External playlists (list=PL…) stay out of mix_set via `classifyByUrl`.
 */
function shouldClassifyAsMixSet(source: UnifiedSource): boolean {
  if (source.contentNodeKind === "mix_set") return true;
  if (source.contentNodeKind === "syncbiz_playlist") return false; // Keep user SyncBiz playlists in their own section.

  const url = source.url?.trim() ?? "";
  const lower = url.toLowerCase();
  const looksLikeYouTube = lower.includes("youtube.com") || lower.includes("youtu.be");
  if (!looksLikeYouTube) return false;

  const durationSeconds = getDurationSeconds(source);
  if (durationSeconds == null) return false;

  const fromUrl = classifyByUrl(url);
  if (fromUrl === "external_playlists") return false;

  const titleCue = titleHasMixSetCue(source.title);
  const mixUrlCue = fromUrl === "mix_set";

  const isHardLong = durationSeconds >= 20 * 60;
  if (isHardLong) {
    if (fromUrl === "single_tracks" && !titleCue) return false;
    return true;
  }

  const isMid = durationSeconds >= 15 * 60 && durationSeconds < 20 * 60;
  if (!isMid) return false;

  return titleCue || mixUrlCue;
}

/**
 * Assign a library section for display. Preserves conservative defaults for legacy rows.
 */
export function getLibrarySection(source: UnifiedSource): LibrarySectionId {
  const kind = source.contentNodeKind;
  // Keep user-defined SyncBiz playlists in their own section.
  if (kind === "syncbiz_playlist") return "syncbiz_playlists";
  if (kind === "mix_set") return "mix_set";

  // Duration-based mix/set rule (overrides only when not already a dedicated SyncBiz playlist section).
  if (shouldClassifyAsMixSet(source)) return "mix_set";

  if (kind) {
    const mapped = mapKindToSection(kind);
    if (mapped !== null) return mapped;
  }

  const url = source.url?.trim() ?? "";
  const fromUrl = classifyByUrl(url);
  if (fromUrl !== null) return fromUrl;

  if (source.origin === "playlist") {
    return "syncbiz_playlists";
  }

  if (source.origin === "source") {
    const fromTarget = classifyByUrl((source.source?.target ?? source.url ?? "").trim());
    if (fromTarget !== null) return fromTarget;
    return "other";
  }

  return "other";
}

/** Partition sources in list order into section buckets (order within each bucket preserved). */
export function partitionSourcesByLibrarySection(sources: UnifiedSource[]): Record<LibrarySectionId, UnifiedSource[]> {
  const empty = (): Record<LibrarySectionId, UnifiedSource[]> => ({
    syncbiz_playlists: [],
    mix_set: [],
    external_playlists: [],
    single_tracks: [],
    other: [],
  });
  const buckets = empty();
  for (const s of sources) {
    buckets[getLibrarySection(s)].push(s);
  }
  return buckets;
}

/** Flatten sections in display order for queue sync. */
export function flattenLibrarySectionOrder(
  buckets: Record<LibrarySectionId, UnifiedSource[]>
): UnifiedSource[] {
  const out: UnifiedSource[] = [];
  for (const id of LIBRARY_SECTION_ORDER) {
    out.push(...buckets[id]);
  }
  return out;
}
