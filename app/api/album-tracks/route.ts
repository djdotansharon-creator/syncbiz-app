import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

/**
 * GET /api/album-tracks?id=1530265303 → { tracks: [{ n, id, name, artist, durationSec, cover, explicit, genre }] }
 *
 * The song list of an album shown in the search shelf (owner 2026-10-22: an opened album is a screen of its own — numbered songs, each with its
 * cover and details). Source: the public iTunes lookup of the album's collection id (no key, official), in the order of the album (disc, then
 * track number). Cached 30 min in memory; any failure → empty list.
 */
type ITunesTrack = {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  trackExplicitness?: string;
  primaryGenreName?: string;
  discNumber?: number;
  trackNumber?: number;
};
type Track = { n: number; id: string; name: string; artist: string; durationSec: number | null; cover: string | null; explicit: boolean; genre: string | null };

const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; tracks: Track[] }>();
const UA = "SyncBizPlayer/1.0 (support@syncbiz.app)";

async function lookup(id: string, country: string): Promise<ITunesTrack[] | null> {
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song&limit=200&country=${country}`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { results?: ITunesTrack[] };
    return j.results ?? [];
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  // signed-in only (PR #61 review 2026-10-23): these routes spend server resources (yt-dlp / outbound searches) — no anonymous callers
  if (!(await getCurrentUserFromCookies())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!/^\d{3,14}$/.test(id)) return NextResponse.json({ tracks: [] });
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json({ tracks: hit.tracks });

  let rows = await lookup(id, "IL");
  if (rows && !rows.some((r) => r.wrapperType === "track")) rows = await lookup(id, "US");
  const songs = (rows ?? [])
    .filter((r) => r.wrapperType === "track" && r.kind === "song" && r.trackName)
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
  const tracks: Track[] = songs.map((r, i) => ({
    n: i + 1,
    id: String(r.trackId ?? `${id}-${i}`),
    name: (r.trackName ?? "").trim(),
    artist: (r.artistName ?? "").trim(),
    durationSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null,
    cover: r.artworkUrl100 ? r.artworkUrl100.replace(/\/\d+x\d+bb\./, "/200x200bb.") : null,
    explicit: r.trackExplicitness === "explicit",
    genre: r.primaryGenreName ?? null,
  }));
  if (rows !== null && tracks.length > 0) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(id, { at: Date.now(), tracks });
  }
  return NextResponse.json({ tracks });
}
