/**
 * Search service – two-layer architecture:
 * 1. Internal: existing library content (playlists, radio, sources, favorites)
 * 2. External: discovery from YouTube, Radio Browser, global catalog
 *
 * Extensible for additional external providers.
 */

import { getPlaylistTracks } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import { rankLibrarySourcesMusicFirst } from "@/lib/music-search-relevance";

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

export type CatalogSearchResult = {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  genres: string[];
};

export type ExternalSearchResults = {
  youtube: YouTubeSearchResult[];
  radio: RadioSearchResult[];
  catalog: CatalogSearchResult[];
};

/** Internal search – filters existing library content. No API calls. */
export function searchInternal(sources: UnifiedSource[], query: string): UnifiedSource[] {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const candidates = sources.filter((s) => {
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
  return rankLibrarySourcesMusicFirst(candidates, query.trim());
}

/** External discovery – calls API. Extensible: add more providers to the response. */
export async function searchExternal(query: string, genreFilter?: string): Promise<ExternalSearchResults> {
  if (!query.trim() || query.trim().length < 2) {
    return { youtube: [], radio: [], catalog: [] };
  }
  const q = encodeURIComponent(query.trim());
  const catalogUrl = genreFilter
    ? `/api/catalog/search?q=${q}&genre=${encodeURIComponent(genreFilter)}`
    : `/api/catalog/search?q=${q}`;
  const [externalRes, catalogRes] = await Promise.allSettled([
    fetch(`/api/sources/search?q=${q}`).then((r) => r.json()),
    fetch(catalogUrl).then((r) => r.json()),
  ]);

  const externalData = externalRes.status === "fulfilled" ? externalRes.value : {};
  const catalogData = catalogRes.status === "fulfilled" ? catalogRes.value : {};

  return {
    youtube: externalData.results || [],
    radio: externalData.radioResults || [],
    catalog: catalogData.items || [],
  };
}

/** Run both internal and external search in parallel. */
export async function searchAll(
  sources: UnifiedSource[],
  query: string,
  genreFilter?: string
): Promise<{
  internal: UnifiedSource[];
  external: ExternalSearchResults;
}> {
  const q = query.trim();
  if (!q || q.length < 2) {
    return { internal: [], external: { youtube: [], radio: [], catalog: [] } };
  }
  const [internal, external] = await Promise.all([
    Promise.resolve(searchInternal(sources, q)),
    searchExternal(q, genreFilter),
  ]);
  return { internal, external };
}
