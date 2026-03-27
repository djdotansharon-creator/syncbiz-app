import type { LibrarySectionId } from "@/lib/library-grouping";

/** Maps grouping section ids to `getTranslations` / `t` keys (see `lib/translations.ts`). */
export const LIBRARY_SECTION_TRANSLATION_KEY: Record<LibrarySectionId, string> = {
  syncbiz_playlists: "librarySectionSyncbizPlaylists",
  mix_set: "librarySectionMixSet",
  external_playlists: "librarySectionExternalPlaylists",
  single_tracks: "librarySectionSingleTracks",
  other: "librarySectionOther",
};

export function librarySectionLabel(t: Record<string, string>, id: LibrarySectionId): string {
  const k = LIBRARY_SECTION_TRANSLATION_KEY[id];
  return t[k] ?? id;
}
