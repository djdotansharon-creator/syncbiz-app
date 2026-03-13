/**
 * Build a minimal UnifiedSource from a URL for remote LOAD_PLAYLIST.
 */

import type { UnifiedSource, SourceProviderType } from "@/lib/source-types";

function inferType(url: string): SourceProviderType {
  const u = url.toLowerCase();
  if (u.includes("youtube") || u.includes("youtu.be")) return "youtube";
  if (u.includes("soundcloud")) return "soundcloud";
  if (u.includes("spotify")) return "spotify";
  if (u.match(/\.(m3u8?|pls)(\?|$)/i)) return "winamp";
  if (u.startsWith("http")) return "stream-url";
  return "local";
}

export function urlToUnifiedSource(url: string): UnifiedSource {
  const type = inferType(url);
  return {
    id: `remote-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title: "Remote",
    genre: "Mixed",
    cover: null,
    type,
    url,
    origin: "source",
  };
}
