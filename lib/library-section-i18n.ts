import type { LibrarySectionId } from "@/lib/library-grouping";

/** Maps grouping section ids to `getTranslations` / `t` keys (see `lib/translations.ts`). */
export const LIBRARY_SECTION_TRANSLATION_KEY: Record<LibrarySectionId, string> = {
  syncbiz_playlists: "librarySectionSyncbizPlaylists",
  mix_set: "librarySectionMixSet",
  external_playlists: "librarySectionExternalPlaylists",
  single_tracks: "librarySectionSingleTracks",
  other: "librarySectionOther",
};

export const LIBRARY_SECTION_SUBTITLE_KEY: Record<LibrarySectionId, string> = {
  syncbiz_playlists: "librarySectionSyncbizPlaylistsHelp",
  mix_set: "librarySectionMixSetHelp",
  external_playlists: "librarySectionExternalPlaylistsHelp",
  single_tracks: "librarySectionSingleTracksHelp",
  other: "librarySectionOtherHelp",
};

export function librarySectionLabel(t: Record<string, string>, id: LibrarySectionId): string {
  const k = LIBRARY_SECTION_TRANSLATION_KEY[id];
  return t[k] ?? id;
}

export function librarySectionSubtitle(t: Record<string, string>, id: LibrarySectionId): string {
  const k = LIBRARY_SECTION_SUBTITLE_KEY[id];
  return t[k] ?? "";
}
