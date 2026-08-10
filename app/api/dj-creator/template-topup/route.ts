import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * DJ Creator top-up: when the local catalog is thin, fill the draft from ADMIN-curated
 * TEMPLATE / OFFICIAL_SYNCBIZ playlists (the same pool that already feeds AI seeds).
 * READ-ONLY. Returns ONLY tracks with a real, playable http(s) URL — never a local path,
 * never a private comment. Relevance-filtered by the selected style; if nothing relevant
 * exists it returns [] (it never invents tracks).
 */
const TEMPLATE_SCOPES = ["TEMPLATE", "OFFICIAL_SYNCBIZ"] as const;
const isPlayableUrl = (u: string) => /^https?:\/\//i.test((u ?? "").trim());
const normTitle = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ rows: [], templatesMatched: 0, templatesConsidered: 0 });

  const q = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 8), 1), 24);
  // The MUSICAL DIRECTION (Genre / Style / Era) is the qualifier — NOT Place/Daypart/Mood.
  // Place/Daypart/Mood only refine within already-genre-matched templates; they never qualify a template.
  const genreTerms = [...new Set(
    [q.get("genre"), q.get("style")]
      .filter(Boolean)
      .flatMap((t) => String(t).toLowerCase().split(/[\s,|/_-]+/))
      .filter((t) => t.length >= 3),
  )];

  const playlists = await prisma.playlist.findMany({
    where: { publicationScope: { in: TEMPLATE_SCOPES as unknown as ("TEMPLATE" | "OFFICIAL_SYNCBIZ")[] } },
    select: {
      name: true, genre: true, primaryGenre: true, mood: true, subGenres: true, useCases: true,
      items: { orderBy: { position: "asc" }, select: { name: true, url: true, cover: true, trackType: true } },
    },
  });

  const relevant = (p: (typeof playlists)[number]): boolean => {
    if (genreTerms.length === 0) return false; // no musical direction chosen → NO template (never a random fill)
    // A template qualifies ONLY if its GENRE fields match the direction. A genre mismatch is rejected
    // even when Place/Daypart/Mood overlap (e.g. a Gym/Happy request never pulls a 70s-Easy template).
    const genreHay = [p.name, p.genre, p.primaryGenre, ...(p.subGenres ?? [])].filter(Boolean).join(" ").toLowerCase();
    return genreTerms.some((t) => genreHay.includes(t));
  };

  // Template MATCH is by the template's structured metadata only (genre/mood/place/daypart via relevant()).
  // Once a template is chosen we PRESERVE its original professional track order — no reordering by
  // SELECTED or by words in the title/artist. (SELECTED remains a small boost only in the catalog path.)
  const seen = new Set<string>();
  const rows: unknown[] = [];
  let templatesMatched = 0;
  for (const p of playlists) {
    if (!relevant(p)) continue;
    templatesMatched++;
    for (const it of p.items) {
      if (rows.length >= limit) break;
      if (!isPlayableUrl(it.url)) continue; // playable only — never a local path
      const key = normTitle(it.name) || it.url.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        catalogItemId: "", title: it.name || "Untitled", url: it.url.trim(),
        thumbnail: it.cover ?? null, provider: it.trackType || "youtube",
        durationSec: null, curationRating: 0, viewCount: null, likeCount: null,
        displayScore: 0, baseFitScore: 0, matchedTags: [],
        recommendedBecause: `From template: ${p.name}`,
      });
    }
    if (rows.length >= limit) break;
  }

  return NextResponse.json({ rows, templatesMatched, templatesConsidered: playlists.length });
}
