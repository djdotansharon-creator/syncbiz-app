import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { searchYouTubeFast } from "@/lib/yt-dlp-search";
import { ensureUniversalTrackId } from "@/lib/universal/ensure-universal-track";

export const dynamic = "force-dynamic";

/**
 * DJ Creator — Charts / known-music fallback (the final tier of Template → Catalog → Charts → Editor).
 *
 * When the local catalog AND admin templates can't reach the target for the chosen musical
 * direction, resolve REAL, playable tracks live from YouTube for exactly that direction
 * (genre + mood + daypart). This is the "fail-forward" guarantee: the DJ Creator must ALWAYS
 * return a playable, editable playlist — never a dead-end.
 *
 * Genre-matched by construction: the search query is built from the user's OWN musical direction,
 * so it can never return an unrelated template (the Gym+Happy→70s bug class is impossible here).
 *
 * Every resolved track is cached (UniversalTrack + a PLAYABLE youtube ProviderMapping) so the same
 * URL is reused across future playlists. READ-ONLY with respect to music files — this never touches
 * a local file, only stores public YouTube URLs + metadata.
 */
const isPlayableUrl = (u: string) => /^https?:\/\//i.test((u ?? "").trim());

// Genre stays the strong anchor. Empirically, adding raw mood/daypart adjectives to a YouTube
// search dilutes relevance (a "house energetic evening" query surfaces yoga/cooking videos),
// so we anchor on the chosen direction and only ensure it reads as a MUSIC search.
const MUSICY = /\b(music|mix|hits|songs|playlist|beats|set|radio)\b/i;
const buildQuery = (genre: string) => {
  const g = genre.replace(/\s+/g, " ").trim();
  return (MUSICY.test(g) ? g : `${g} music`).slice(0, 80);
};

// Old music (retro genres): keep the query stable — for known music, freshness should come from our
// own SELECTED + view-ranked catalog, not from chasing brand-new uploads.
const RETRO = /\b(60s|70s|80s|90s|oldies|classic|classics|retro|vintage|throwback|nostalg)/i;
// New music: rotate a freshness qualifier so repeated identical requests surface the most CURRENT sets.
function pickSearchQuery(genre: string): string {
  const base = buildQuery(genre);
  if (RETRO.test(genre)) return base;
  const year = new Date().getFullYear();
  const variants = [base, `${base} ${year}`, `${base} ${year - 1}`, `${base} new`];
  return variants[Math.floor(Math.random() * variants.length)].slice(0, 80);
}
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function splitArtistTitle(raw: string): { artist: string | null; title: string } {
  const t = (raw ?? "").trim();
  const i = t.indexOf(" - ");
  if (i > 0) return { artist: t.slice(0, i).trim(), title: t.slice(i + 3).trim() };
  return { artist: null, title: t };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ rows: [], resolved: 0, source: "recommend", reason: "no_user" });

  const q = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 12), 1), 20);
  const genre = (q.get("genre") ?? "").trim();

  // A musical direction is REQUIRED — this tier never fires a random/unqualified search.
  if (genre.length < 2) {
    return NextResponse.json({ rows: [], resolved: 0, source: "recommend", reason: "no_direction" });
  }

  const query = pickSearchQuery(genre);
  // Fetch a LARGER candidate pool than we need so repeated identical requests can ROTATE — the user
  // should get fresh tracks AND a fresh order each time, never the same list as before.
  const poolSize = Math.min(35, Math.max(limit * 2 + 5, 20));

  let hits: Awaited<ReturnType<typeof searchYouTubeFast>> = [];
  try {
    hits = await searchYouTubeFast(query, poolSize);
  } catch {
    return NextResponse.json({ rows: [], resolved: 0, source: "recommend", reason: "search_failed", query });
  }

  // Dedup into candidates (searchYouTubeFast already sorts by view_count desc = quality first).
  const seen = new Set<string>();
  const candidates: { videoId: string; url: string; title: string; cover: string | null; duration?: number; view?: number }[] = [];
  for (const h of hits) {
    const videoId = (h.id ?? "").trim();
    const url = (h.url ?? (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "")).trim();
    const title = (h.title ?? "").trim();
    if (!videoId || !isPlayableUrl(url) || !title) continue;
    const key = videoId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ videoId, url, title, cover: h.cover ?? null, duration: h.duration, view: h.view_count });
  }

  // Quality floor + rotation: keep the higher-view slice (quality), then random-sample the target
  // count and shuffle its order → different tracks AND a different order every time for the same request.
  const qualityWindow = Math.min(candidates.length, Math.max(limit * 2, 18));
  const pool = candidates.slice(0, qualityWindow);
  shuffleInPlace(pool);
  const picked = pool.slice(0, limit);

  const rows = picked.map((p) => ({
    catalogItemId: "", title: p.title, url: p.url,
    thumbnail: p.cover, provider: "youtube",
    durationSec: p.duration ?? null, curationRating: 0,
    viewCount: p.view ?? null, likeCount: null,
    displayScore: 0, baseFitScore: 0, matchedTags: [],
    recommendedBecause: `From ${genre} recommendations`,
  }));

  // Cache for reuse — in PARALLEL, best-effort. Never blocks/loses the result set (fail-forward).
  await Promise.all(
    picked.map(async (p) => {
      try {
        // Single identity path — reuse ONLY on a strong id (provider+externalId / ISRC), else new Recording.
        const { universalTrackId: utid } = await ensureUniversalTrackId(prisma, {
          provider: "youtube", externalId: p.videoId, title: p.title,
          durationMs: p.duration ? Math.round(p.duration * 1000) : null,
        });
        await prisma.providerMapping.upsert({
          where: { provider_externalId: { provider: "youtube", externalId: p.videoId } },
          create: {
            provider: "youtube", externalId: p.videoId, externalUrl: p.url, universalTrackId: utid,
            playableStatus: "PLAYABLE", matchMethod: "dj_recommend", matchConfidence: 0.75, lastVerifiedAt: new Date(),
          },
          update: { externalUrl: p.url, playableStatus: "PLAYABLE", lastVerifiedAt: new Date() },
        });

        // Enter it into the CATALOG (URL + views + genre) the moment it's found — so it's reused
        // instantly and SAVE is fast (the track is already catalogued → no per-track metadata fetch on
        // save). No taxonomy link: the genre-accurate charts tier reads genres[]; smart-search
        // (taxonomy-based) intentionally ignores these to avoid its genre-blind ranking.
        const { artist, title } = splitArtistTitle(p.title);
        const durSec = p.duration ? Math.round(p.duration) : null;
        const cat = await prisma.catalogItem.findFirst({ where: { url: p.url }, select: { id: true, genres: true } });
        const catId = cat
          ? (await prisma.catalogItem.update({
              where: { id: cat.id },
              data: { videoId: p.videoId, provider: "youtube", thumbnail: p.cover ?? null, durationSec: durSec, genres: [...new Set([...(cat.genres ?? []), genre])] },
            })).id
          : (await prisma.catalogItem.create({
              data: { url: p.url, canonicalUrl: p.url, videoId: p.videoId, provider: "youtube", title, artist, thumbnail: p.cover ?? null, durationSec: durSec, genres: [genre] },
            })).id;
        await prisma.catalogSourceSnapshot.deleteMany({ where: { catalogItemId: catId } });
        await prisma.catalogSourceSnapshot.create({
          data: { catalogItemId: catId, provider: "youtube", sourceUrl: p.url, fetchStatus: "SUCCESS", fetchMethod: "YTDLP", title: p.title, viewCount: p.view ?? null, durationSec: durSec, thumbnail: p.cover ?? null },
        });
      } catch { /* best-effort cache */ }
    }),
  ).catch(() => {});

  return NextResponse.json({ rows, resolved: rows.length, source: "recommend", query });
}
