import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * DJ Creator — the "SyncBiz Charts" tier (most-played, from our catalog).
 *
 * Returns catalog tracks that MATCH the chosen genre, ranked by real YouTube view count (from the
 * latest CatalogSourceSnapshot). Genre-accurate by construction (filters on the item's own genres),
 * so it never injects off-genre results. Fed by scripts/ingest-youtube-charts.ts.
 *
 * Deliberately queries the CatalogItem.genres[] array + snapshot views directly (NOT smart-search's
 * taxonomy scorer), so charts are genre-correct without depending on the fit-rule engine.
 */
const norm = (s: string) => (s ?? "").trim().toLowerCase();

function genreMatches(direction: string, genres: string[]): boolean {
  const hay = (genres ?? []).join(" | ").toLowerCase();
  if (!hay) return false;
  const tokens = norm(direction).split(/[\s,|/_-]+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  const expanded = tokens.flatMap((t) => {
    const dec = t.match(/^(\d0)('?s)?$/);
    if (dec) return [t, `19${dec[1]}`, `20${dec[1]}`];
    return [t];
  });
  return expanded.some((t) => hay.includes(t));
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ rows: [], resolved: 0, source: "charts", reason: "no_user" });

  const q = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 12), 1), 30);
  const genre = (q.get("genre") ?? "").trim();
  if (genre.length < 2) return NextResponse.json({ rows: [], resolved: 0, source: "charts", reason: "no_direction" });

  const items = await prisma.catalogItem.findMany({
    where: { archivedAt: null, genres: { isEmpty: false } },
    select: {
      title: true, artist: true, url: true, genres: true, thumbnail: true, durationSec: true,
      catalogSourceSnapshots: { orderBy: { fetchedAt: "desc" }, take: 1, select: { viewCount: true } },
    },
  });

  const matched = items
    .filter((it) => /^https?:\/\//i.test(it.url ?? "") && genreMatches(genre, it.genres))
    .map((it) => ({
      title: it.title ?? "", artist: it.artist, url: it.url, thumbnail: it.thumbnail,
      durationSec: it.durationSec ?? null, viewCount: it.catalogSourceSnapshots[0]?.viewCount ?? null,
    }));

  if (matched.length === 0) return NextResponse.json({ rows: [], resolved: 0, source: "charts", reason: "no_chart_match" });

  // Most-played first (quality), then rotate for variety: keep the top-viewed slice, sample + shuffle.
  matched.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  const qualityWindow = Math.min(matched.length, Math.max(limit * 2, 18));
  const pool = matched.slice(0, qualityWindow);
  shuffleInPlace(pool);
  const picked = pool.slice(0, limit);

  const rows = picked.map((m) => ({
    catalogItemId: "", title: m.artist ? `${m.artist} — ${m.title}` : m.title, url: m.url,
    thumbnail: m.thumbnail, provider: "youtube",
    durationSec: m.durationSec, curationRating: 0, viewCount: m.viewCount, likeCount: null,
    displayScore: 0, baseFitScore: 0, matchedTags: [],
    recommendedBecause: "From SyncBiz charts (most-played)",
  }));

  return NextResponse.json({ rows, resolved: rows.length, source: "charts" });
}
