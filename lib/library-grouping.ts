/**
 * Visual library sections for /sources — deterministic, uses UnifiedSource + URL heuristics only.
 */

import { shouldClassifyLeafUrlAsMixSet } from "@/lib/library-leaf-mix-heuristics";
import { classifyLibraryEntityContract, type UnifiedSource } from "@/lib/source-types";
import { getYouTubePlaylistId, isYouTubeMixUrl } from "@/lib/playlist-utils";
import type { ContentNodeKind } from "@/lib/types";

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

/**
 * Product rule: `mix_set` auto-classification from duration (YouTube only).
 * Delegates to shared leaf heuristic (keeps grouping aligned with contracts + badges).
 */
function shouldClassifyAsMixSet(source: UnifiedSource): boolean {
  if (source.contentNodeKind === "syncbiz_playlist") return false;
  return shouldClassifyLeafUrlAsMixSet(source);
}

export function getLibrarySection(source: UnifiedSource): LibrarySectionId {
  if (source.origin === "radio" || source.contentNodeKind === "radio_stream") return "other";

  const contract = classifyLibraryEntityContract(source);

  if (contract.entityKind === "collection") {
    if (contract.collectionSubtype === "syncbiz_playlist") return "syncbiz_playlists";
    if (contract.collectionSubtype === "external_playlist") return "external_playlists";
    return "other";
  }

  if (contract.entityKind === "item") {
    if (contract.itemSubtype === "mix_set") return "mix_set";
    if (shouldClassifyAsMixSet(source)) return "mix_set";
    if (contract.itemSubtype === "radio_stream" || contract.itemSubtype === "ai_asset") return "other";
    if (contract.itemSubtype === "single_track") return "single_tracks";
  }

  const kind = source.contentNodeKind;
  if (kind === "syncbiz_playlist") return "syncbiz_playlists";

  if (shouldClassifyAsMixSet(source)) return "mix_set";

  if (kind) {
    const mapped = mapKindToSection(kind);
    if (mapped !== null) return mapped;
  }

  const url = source.url?.trim() ?? "";
  const fromUrl = classifyByUrl(url);
  if (fromUrl !== null) return fromUrl;

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
