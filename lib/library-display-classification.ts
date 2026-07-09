/**
 * Single display contract for library badges: LIST (containers), SINGLE / SET / LOCAL (leaves), RADIO.
 */

import { getPlaylistTracks } from "@/lib/playlist-types";
import { shouldClassifyLeafUrlAsMixSet } from "@/lib/library-leaf-mix-heuristics";
import { classifyLibraryEntityContract, type UnifiedSource } from "@/lib/source-types";
import { isValidLocalFilePlaybackPath } from "@/lib/url-validation";

export type LibraryKindBadge = "LIST" | "SINGLE" | "SET" | "LOCAL" | "RADIO";

/** True when the item is computer / folder music (desktop playback path). */
export function isLibraryLocalSource(source: UnifiedSource): boolean {
  if (source.type === "local" || source.type === "winamp") return true;
  if (source.source?.type === "local_playlist") return true;
  const u = (source.url ?? "").trim();
  if (u.startsWith("local://user-playlist/")) return false;
  if (u.startsWith("local://")) return true;
  return isValidLocalFilePlaybackPath(u);
}

function sumPlaylistTrackDurationSeconds(source: UnifiedSource): number | null {
  if (!source.playlist) return null;
  const tracks = getPlaylistTracks(source.playlist);
  let sum = 0;
  let any = false;
  for (const t of tracks) {
    const d = t.durationSeconds;
    if (typeof d === "number" && d > 0) {
      sum += d;
      any = true;
    }
  }
  return any ? sum : null;
}

/** Public meta for LIST tiles (count + optional summed track duration). */
export function libraryListContainerMeta(source: UnifiedSource): { trackCount: number; durationSecondsTotal: number | null } {
  if (!source.playlist) return { trackCount: 0, durationSecondsTotal: null };
  const tracks = getPlaylistTracks(source.playlist);
  const summed = sumPlaylistTrackDurationSeconds(source);
  const fallback =
    typeof source.playlist.durationSeconds === "number" && source.playlist.durationSeconds > 0
      ? source.playlist.durationSeconds
      : null;
  const durationSecondsTotal = summed != null ? summed : fallback;
  return { trackCount: tracks.length, durationSecondsTotal };
}

export function resolveLibraryKindBadge(source: UnifiedSource): LibraryKindBadge {
  if (source.origin === "radio") return "RADIO";
  const contract = classifyLibraryEntityContract(source);
  if (
    contract.entityKind === "collection" &&
    (contract.collectionSubtype === "syncbiz_playlist" || contract.collectionSubtype === "external_playlist")
  ) {
    return "LIST";
  }
  if (contract.entityKind === "item") {
    if (contract.itemSubtype === "radio_stream") return "RADIO";
    if (contract.itemSubtype === "mix_set") return "SET";
    if (shouldClassifyLeafUrlAsMixSet(source)) return "SET";
    if (isLibraryLocalSource(source)) return "LOCAL";
    return "SINGLE";
  }
  if (shouldClassifyLeafUrlAsMixSet(source)) return "SET";
  return "SINGLE";
}

export function libraryKindBadgeUpper(kind: LibraryKindBadge): string {
  if (kind === "LIST") return "PLAYLIST";
  if (kind === "RADIO") return "RADIO";
  return kind;
}

export function libraryKindBadgeArtClass(kind: LibraryKindBadge): string {
  return `library-card-kind-badge--${kind.toLowerCase()}`;
}

/** Human-readable source label for top-right card badge. */
export function librarySourceBadgeLabel(source: UnifiedSource, kindBadge: LibraryKindBadge): string {
  if (kindBadge === "LIST") return "Playlist";
  if (source.origin === "radio") return "Radio";
  if (isLibraryLocalSource(source)) return "Local";
  switch (source.type) {
    case "youtube":
      return "YouTube";
    case "soundcloud":
      return "SoundCloud";
    case "spotify":
      return "Spotify";
    case "local":
    case "winamp":
      return "Local";
    default:
      break;
  }
  if (source.origin === "playlist" && source.playlist?.libraryPlacement !== "ready_external") {
    return "SyncBiz";
  }
  return "URL";
}
