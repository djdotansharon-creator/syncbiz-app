/**
 * Single display contract for library badges: LIST (real containers), SINGLE / SET (leaves), RADIO.
 */

import { getPlaylistTracks } from "@/lib/playlist-types";
import { shouldClassifyLeafUrlAsMixSet } from "@/lib/library-leaf-mix-heuristics";
import { classifyLibraryEntityContract, type UnifiedSource } from "@/lib/source-types";

export type LibraryKindBadge = "LIST" | "SINGLE" | "SET" | "RADIO";

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
    if (contract.itemSubtype === "mix_set") return "SET";
    if (shouldClassifyLeafUrlAsMixSet(source)) return "SET";
    if (contract.itemSubtype === "radio_stream") return "RADIO";
    return "SINGLE";
  }
  if (shouldClassifyLeafUrlAsMixSet(source)) return "SET";
  return "SINGLE";
}

export function libraryKindBadgeUpper(kind: LibraryKindBadge): string {
  if (kind === "RADIO") return "Radio";
  return kind;
}

/** Tailwind classes for top-left library badges ( SourceCard + branch tiles ). */
export function libraryKindBadgeArtClass(kind: LibraryKindBadge): string {
  switch (kind) {
    case "LIST":
      return "!border-cyan-400/55 !bg-cyan-950/85 !text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.12)] border";
    case "SINGLE":
      return "!border-emerald-400/55 !bg-emerald-950/85 !text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.12)] border";
    case "SET":
      return "!border-violet-400/55 !bg-violet-950/85 !text-violet-100 shadow-[0_0_12px_rgba(167,139,250,0.12)] border";
    case "RADIO":
      return "!border-rose-400/55 !bg-rose-950/85 !text-rose-100 shadow-[0_0_12px_rgba(251,113,133,0.12)] border";
  }
}
