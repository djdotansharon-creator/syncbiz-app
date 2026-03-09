import { NextResponse } from "next/server";
import { listPlaylists } from "@/lib/playlist-store";
import { listRadioStations } from "@/lib/radio-store";
import { radioToUnified } from "@/lib/radio-utils";
import { db } from "@/lib/store";
import type { UnifiedSource, SourceProviderType } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";
import { getSourceArtworkUrl, detectProvider } from "@/lib/player-utils";
import { getYouTubeThumbnail } from "@/lib/playlist-utils";

function playlistToUnified(p: Playlist): UnifiedSource {
  const cover = p.thumbnail || p.cover || null;
  return {
    id: `pl-${p.id}`,
    title: p.name,
    genre: p.genre || "Mixed",
    cover,
    type: p.type as SourceProviderType,
    url: p.url,
    origin: "playlist",
    playlist: p,
  };
}

function dbSourceToUnified(s: { id: string; name: string; target: string; artworkUrl?: string; uriOrPath?: string; type?: string }): UnifiedSource {
  const target = (s.target ?? s.uriOrPath ?? "").trim();
  const provider = detectProvider(target);
  let type: SourceProviderType = "stream-url";
  if (provider === "youtube") type = "youtube";
  else if (provider === "soundcloud") type = "soundcloud";
  else if (target.includes("spotify")) type = "spotify";
  else if (target.match(/\.(m3u8?|pls)(\?|$)/i)) type = "winamp";
  else if (target.startsWith("http")) type = "stream-url";
  else type = "local";

  const cover = getSourceArtworkUrl(s as import("@/lib/types").Source) || getYouTubeThumbnail(target) || null;

  return {
    id: `src-${s.id}`,
    title: s.name,
    genre: "Mixed",
    cover,
    type,
    url: target,
    origin: "source",
    source: s as import("@/lib/types").Source,
  };
}

export async function GET() {
  try {
    const [playlists, radioStations, dbSources] = await Promise.all([
      listPlaylists(),
      listRadioStations(),
      Promise.resolve(db.getSources()),
    ]);

    const items: UnifiedSource[] = [
      ...playlists.map(playlistToUnified),
      ...radioStations.map(radioToUnified),
      ...dbSources.map(dbSourceToUnified),
    ];

    return NextResponse.json(items);
  } catch (e) {
    console.error("[api/sources/unified] GET error:", e);
    return NextResponse.json({ error: "Failed to list sources" }, { status: 500 });
  }
}
