/**
 * Search service – two-layer architecture:
 * 1. Internal: existing library content (playlists, radio, sources, favorites)
 * 2. External: discovery from YouTube, Radio Browser, future providers
 *
 * Extensible for additional external providers.
 */

import { getPlaylistTracks } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";

export type YouTubeSearchResult = {
  title: string;
  url: string;
  cover: string | null;
  type: "youtube" | "soundcloud";
  viewCount?: number;
  durationSeconds?: number;
};

export type RadioSearchResult = {
  title: string;
  url: string;
  cover: string | null;
  genre: string;
};

export type ExternalSearchResults = {
  youtube: YouTubeSearchResult[];
  radio: RadioSearchResult[];
};

/** Internal search – filters existing library content. No API calls. */
export function searchInternal(sources: UnifiedSource[], query: string): UnifiedSource[] {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];
  const words = q.split(/\s+/).filter(Boolean);
  return sources.filter((s) => {
    const title = s.title.toLowerCase();
    const genre = (s.genre ?? "").toLowerCase();
    const type = s.type.toLowerCase();
    const radioName = s.origin === "radio" && s.radio?.name ? s.radio.name.toLowerCase() : "";
    const sourceName = s.source?.name ? s.source.name.toLowerCase() : "";
    let searchable = `${title} ${genre} ${type} ${radioName} ${sourceName}`;
    if (s.playlist) {
      const tracks = getPlaylistTracks(s.playlist);
      const trackNames = tracks.map((t) => (t.name || (t as { title?: string }).title || "").toLowerCase()).join(" ");
      searchable += ` ${trackNames}`;
    }
    return words.some((w) => searchable.includes(w));
  });
}

/** External discovery – calls API. Extensible: add more providers to the response. */
export async function searchExternal(query: string): Promise<ExternalSearchResults> {
  if (!query.trim() || query.trim().length < 2) {
    return { youtube: [], radio: [] };
  }
  const res = await fetch(`/api/sources/search?q=${encodeURIComponent(query.trim())}`);
  const data = await res.json();
  return {
    youtube: data.results || [],
    radio: data.radioResults || [],
  };
}

/** Run both internal and external search in parallel. */
export async function searchAll(
  sources: UnifiedSource[],
  query: string
): Promise<{
  internal: UnifiedSource[];
  external: ExternalSearchResults;
}> {
  const q = query.trim();
  if (!q || q.length < 2) {
    return { internal: [], external: { youtube: [], radio: [] } };
  }
  const [internal, external] = await Promise.all([
    Promise.resolve(searchInternal(sources, q)),
    searchExternal(q),
  ]);
  return { internal, external };
}
