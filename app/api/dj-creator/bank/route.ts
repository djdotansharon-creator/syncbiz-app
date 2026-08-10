import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * DJ Creator — the "your bank" tier (② in the owner's order: catalog → YOUR bank → YouTube).
 * Returns the OWNER's own SELECTED bank tracks matching the chosen direction, ranked by rating.
 * They play LOCAL-FIRST from the physical files on the bank machine (the `local` ProviderMapping);
 * the `youtube` mapping is the URL used for remote/browser clients. READ-ONLY w.r.t. music files —
 * this only reads metadata already in the DB; it never opens, writes, moves, or changes a file.
 */
const norm = (s: string) => (s ?? "").trim().toLowerCase();
const SELECTED_RE = /\bselect(ed|es|e)?\b/i;

function isSelected(manual: boolean | null | undefined, comments: string[]): boolean {
  if (manual === true) return true;
  if (manual === false) return false;
  return (comments ?? []).some((c) => SELECTED_RE.test(c ?? ""));
}

// Match the chosen direction against the bank's "decade - style - intensity" taxonomy.
function genreMatches(direction: string, genres: string[], override: string | null | undefined): boolean {
  const hay = [...(genres ?? []), override ?? ""].filter(Boolean).join(" | ").toLowerCase();
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
  if (!user) return NextResponse.json({ rows: [], resolved: 0, source: "bank", reason: "no_user" });

  const q = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 12), 1), 30);
  const genre = (q.get("genre") ?? "").trim();
  if (genre.length < 2) return NextResponse.json({ rows: [], resolved: 0, source: "bank", reason: "no_direction" });

  const files = await prisma.localTrackFile.findMany({
    where: { availability: "available" },
    select: {
      originalTitle: true, originalArtists: true, originalGenres: true, originalComments: true,
      originalRating: true, universalTrackId: true,
      enrichment: { select: { manualSelected: true, genreOverride: true, ratingOverride: true } },
    },
  });

  type Cand = { utid: string; title: string; artist: string; rating: number };
  const matched: Cand[] = [];
  let unresolvedInBank = 0;
  for (const f of files) {
    if (!genreMatches(genre, f.originalGenres, f.enrichment?.genreOverride)) continue;
    if (!isSelected(f.enrichment?.manualSelected, f.originalComments)) continue;
    if (!f.universalTrackId) { unresolvedInBank++; continue; }
    matched.push({
      utid: f.universalTrackId,
      title: (f.originalTitle ?? "").trim() || (f.originalArtists?.[0] ?? "").trim(),
      artist: (f.originalArtists?.[0] ?? "").trim(),
      rating: f.enrichment?.ratingOverride ?? f.originalRating ?? 0,
    });
  }
  if (matched.length === 0) {
    return NextResponse.json({ rows: [], resolved: 0, source: "bank", unresolvedInBank, reason: "no_playable_bank_match" });
  }

  const utids = [...new Set(matched.map((m) => m.utid))];
  const maps = await prisma.providerMapping.findMany({
    where: { universalTrackId: { in: utids }, provider: "youtube", playableStatus: "PLAYABLE" },
    select: { universalTrackId: true, externalUrl: true },
  });
  const urlByUtid = new Map<string, string>();
  for (const m of maps) if (m.externalUrl && !urlByUtid.has(m.universalTrackId)) urlByUtid.set(m.universalTrackId, m.externalUrl);

  const playable = matched.filter((m) => urlByUtid.has(m.utid));
  if (playable.length === 0) {
    return NextResponse.json({ rows: [], resolved: 0, source: "bank", unresolvedInBank: unresolvedInBank + matched.length, reason: "bank_not_resolved" });
  }

  playable.sort((a, b) => b.rating - a.rating);
  const qualityWindow = Math.min(playable.length, Math.max(limit * 2, 18));
  const pool = playable.slice(0, qualityWindow);
  shuffleInPlace(pool);
  const picked = pool.slice(0, limit);

  const rows = picked.map((m) => ({
    catalogItemId: "", title: [m.artist, m.title].filter(Boolean).join(" — ") || m.title || "Untitled",
    url: urlByUtid.get(m.utid) ?? "", thumbnail: null, provider: "youtube",
    durationSec: null, curationRating: 0, viewCount: null, likeCount: null,
    displayScore: 0, baseFitScore: 0, matchedTags: [],
    recommendedBecause: "From your library (SELECTED)",
  }));

  // Catalog every returned bank track (URL + a SUCCESS snapshot) so SAVE is instant — the save's
  // per-track YouTube-metadata fetch short-circuits when a SUCCESS snapshot already exists. Best-effort.
  const ytId = (u: string) => (u ?? "").match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/)?.[1] ?? "";
  await Promise.all(
    picked.map(async (m) => {
      try {
        const url = urlByUtid.get(m.utid);
        if (!url) return;
        const videoId = ytId(url) || null;
        const cat = await prisma.catalogItem.findFirst({ where: { url }, select: { id: true, genres: true } });
        const catId = cat
          ? (await prisma.catalogItem.update({ where: { id: cat.id }, data: { provider: "youtube", ...(videoId ? { videoId } : {}), genres: [...new Set([...(cat.genres ?? []), genre])] } })).id
          : (await prisma.catalogItem.create({ data: { url, canonicalUrl: url, videoId, provider: "youtube", title: m.title || "Untitled", artist: m.artist || null, genres: [genre] } })).id;
        const hasOk = await prisma.catalogSourceSnapshot.findFirst({ where: { catalogItemId: catId, fetchStatus: { in: ["SUCCESS", "PARTIAL"] } }, select: { id: true } });
        if (!hasOk) {
          await prisma.catalogSourceSnapshot.create({
            data: { catalogItemId: catId, provider: "youtube", sourceUrl: url, fetchStatus: "SUCCESS", fetchMethod: "YTDLP", title: m.title || null },
          });
        }
      } catch { /* best-effort cache */ }
    }),
  ).catch(() => {});

  return NextResponse.json({ rows, resolved: rows.length, source: "bank", unresolvedInBank });
}
