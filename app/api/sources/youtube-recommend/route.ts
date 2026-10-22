import { NextRequest, NextResponse } from "next/server";
import { enumerateYouTubeMixPlaylistCandidates, searchYouTubeFast } from "@/lib/yt-dlp-search";

/**
 * GET /api/sources/youtube-recommend?v=<videoId>&title=<title>&artist=<artist> → { candidates: [{ videoId, title, url, thumbnailUrl, … }], source }
 *
 * "What plays next" for a song that stands alone (owner 2026-10-18: after a song ends play what the platform recommends,
 * prepared in advance — for EVERY song). `v` is optional: a SoundCloud/Spotify song has no YouTube id, so it is seeded by
 * its title/artist instead. First choice: the video's own YouTube MIX (`list=RD<id>`); the singer's most-viewed songs are
 * searched IN PARALLEL (not after the mix gave up) so a slow/failed mix never leaves the song without a next one. The current
 * song itself (same id, or another upload of the same title) is never returned. Concurrent identical calls share one run;
 * answers are cached 20 min, empty answers never are (the client retries).
 */
const CACHE_TTL_MS = 20 * 60_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; body: Body }>();
const inflight = new Map<string, Promise<Body>>();

type Cand = { videoId: string; title: string; url: string; thumbnailUrl: string; durationSeconds?: number; viewCount?: number };
type Body = { candidates: Cand[]; source: "mix" | "search" | "none" };

const capped = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** "Artist - Song (Official Video)" → "Artist"; otherwise the first words of the title */
function artistGuess(title: string): string {
  const m = title.match(/^\s*([^\-–—|:]{2,40}?)\s*[-–—|:]\s*\S/);
  const raw = (m ? m[1]! : title).replace(/\([^)]*\)|\[[^\]]*\]/g, "").trim();
  return raw.split(/\s+/).slice(0, 4).join(" ");
}

const tokens = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((w) => w.length > 1),
  );

/** Another upload / version of the very same song (most of its words shared) — never a "next" song. */
function sameSong(a: string, b: string): boolean {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size) >= 0.8;
}

async function build(v: string, title: string, artist: string): Promise<Body> {
  const mixP = v ? capped(enumerateYouTubeMixPlaylistCandidates(`https://www.youtube.com/watch?v=${v}&list=RD${v}`, 8), 12000) : Promise.resolve(null);
  const queries = [artist, artistGuess(title), title.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").trim().split(/\s+/).slice(0, 6).join(" ")]
    .map((q) => q.trim())
    .filter((q, i, all) => q.length >= 2 && all.indexOf(q) === i)
    .slice(0, 2);
  // started NOW, in parallel with the mix
  const searchP = Promise.all(queries.map((q) => capped(searchYouTubeFast(q, 10), 10000))).then((lists) => lists.flatMap((l) => l ?? []));

  const mix = await mixP;
  const fromMix = (mix?.candidates ?? []).filter((c) => c.videoId !== v && !(title && sameSong(c.title, title)));
  if (fromMix.length > 0) return { candidates: fromMix.slice(0, 4), source: "mix" };

  const found = await searchP;
  const seen = new Set<string>();
  const candidates: Cand[] = found
    .filter((r) => r.id && r.id !== v && /^https?:\/\//i.test(r.url) && !seen.has(r.id) && seen.add(r.id) && !(title && sameSong(r.title, title)))
    .sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0))
    .slice(0, 4)
    .map((r) => ({ videoId: r.id, title: r.title, url: r.url, thumbnailUrl: r.cover ?? `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`, durationSeconds: r.duration, viewCount: r.view_count }));
  return { candidates, source: candidates.length > 0 ? "search" : "none" };
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("v")?.trim() ?? "";
  const v = /^[\w-]{11}$/.test(raw) ? raw : "";
  const title = (req.nextUrl.searchParams.get("title") ?? "").slice(0, 160).trim();
  const artist = (req.nextUrl.searchParams.get("artist") ?? "").slice(0, 80).trim();
  if (!v && !title) return NextResponse.json({ candidates: [], source: "none" });
  const key = v || `t:${title.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json(hit.body);

  let run = inflight.get(key);
  if (!run) {
    run = build(v, title, artist).finally(() => inflight.delete(key));
    inflight.set(key, run);
  }
  const body = await run;
  if (body.candidates.length > 0) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), body });
  }
  return NextResponse.json(body);
}
