import { NextRequest, NextResponse } from "next/server";
import { searchYouTubeFast, searchYouTubePlaylists } from "@/lib/yt-dlp-search";

/**
 * GET /api/album-playlist?artist=…&album=…&tracks=12 → { playlist: { url, playlistId, title, cover, videoCount } | null }
 *
 * An album shown in the search shelf (iTunes metadata) has no stream of its own — this finds the YouTube playlist that
 * carries it (YouTube Music publishes albums as playlists), the best title match with a track count near the album's.
 * Cached 30 min per artist+album.
 */
const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; playlist: unknown }>();

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[֑-ׇ̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const artist = req.nextUrl.searchParams.get("artist")?.trim() ?? "";
  const album = req.nextUrl.searchParams.get("album")?.trim() ?? "";
  const tracks = Number(req.nextUrl.searchParams.get("tracks") ?? "0") || 0;
  if (album.length < 2 || album.length > 100) return NextResponse.json({ playlist: null });
  const key = `${artist}|${album}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json({ playlist: hit.playlist });

  type Found = { url: string; playlistId: string; title: string; cover: string | null; videoCount: number | null };
  const aw = tokens(album);
  const artw = tokens(artist);
  // 1) a YouTube PLAYLIST that carries the album (YouTube Music publishes albums that way)
  const fromPlaylists = async (): Promise<Found | null> => {
    try {
      const list = await searchYouTubePlaylists(`${artist} ${album} album`.trim(), 8);
      let best: { score: number; p: (typeof list)[number] } | null = null;
      for (const p of list) {
        const t = tokens(`${p.title} ${p.uploader ?? ""}`);
        const nameHit = aw.length ? aw.filter((w) => t.includes(w)).length / aw.length : 0;
        const artistHit = artw.length ? artw.filter((w) => t.some((x) => x.startsWith(w) || w.startsWith(x))).length / artw.length : 1;
        const countFit = tracks && p.videoCount ? Math.max(0, 1 - Math.abs(p.videoCount - tracks) / Math.max(tracks, 6)) : 0.5;
        const score = nameHit * 2 + artistHit + countFit * 0.8 + (/^OLAK/i.test(p.playlistId) ? 0.6 : 0);
        if (nameHit >= 0.5 && artistHit >= 0.5 && (!best || score > best.score)) best = { score, p };
      }
      return best ? { url: best.p.url, playlistId: best.p.playlistId, title: best.p.title, cover: best.p.cover, videoCount: best.p.videoCount ?? null } : null;
    } catch {
      return null;
    }
  };
  // 2) fallback: ONE long "full album" video (20 min +) whose title carries the album and the singer
  const fromFullAlbumVideo = async (): Promise<Found | null> => {
    try {
      const list = await searchYouTubeFast(`${artist} ${album} full album`.trim(), 8);
      for (const v of list) {
        const t = tokens(v.title);
        const nameHit = aw.length ? aw.filter((w) => t.includes(w)).length / aw.length : 0;
        const artistHit = artw.length ? artw.filter((w) => t.some((x) => x.startsWith(w) || w.startsWith(x))).length / artw.length : 1;
        if ((v.duration ?? 0) >= 1200 && nameHit >= 0.6 && artistHit >= 0.5) return { url: v.url, playlistId: v.id, title: v.title, cover: v.cover, videoCount: null };
      }
      return null;
    } catch {
      return null;
    }
  };
  const capped = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const [pl, video] = await Promise.all([capped(fromPlaylists(), 8000), capped(fromFullAlbumVideo(), 8000)]);
  const playlist = pl ?? video ?? null;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  if (playlist) cache.set(key, { at: Date.now(), playlist });
  return NextResponse.json({ playlist });
}
