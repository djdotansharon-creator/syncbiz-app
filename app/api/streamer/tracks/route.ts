import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getReadyMediaAssetGenreIds, listReadyMediaAssetLogicalIds } from "@/lib/media/media-asset-db";
import { POC_MUSIC_BANK_CATALOG } from "@/lib/music-bank/poc-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Native streamer track resolver (Phase 2A-2). Returns a queue of REAL, prod-READY Music Bank
 * tracks for a genre, so the native ExoPlayer appliance can play them via
 * `/api/media/<id>?mt=<token>` (token from POST /api/music-bank/authorize). Titles are joined
 * from the catalog by logicalId. Server-authoritative: only READY assets, requires a session.
 * Reuses the existing catalog + MediaAsset DB — no parallel system.
 */
export async function GET(req: Request) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const reqGenre = url.searchParams.get("genre");
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

  const readyGenres = await getReadyMediaAssetGenreIds();
  if (readyGenres.length === 0) {
    return NextResponse.json({ ok: false, error: "No media catalog is available on this server." }, { status: 503 });
  }
  const genre = reqGenre && readyGenres.includes(reqGenre) ? reqGenre : readyGenres[0];

  const rows = await listReadyMediaAssetLogicalIds(genre, limit);

  const titleMap = new Map<string, { title: string; durationSec: number }>();
  for (const g of POC_MUSIC_BANK_CATALOG.genres) {
    for (const t of g.tracks) titleMap.set(t.id, { title: t.title, durationSec: t.durationSeconds ?? 0 });
  }

  const tracks = rows.map((r) => {
    const meta = titleMap.get(r.logicalId);
    return {
      id: r.logicalId,
      title: meta?.title ?? r.logicalId,
      durationSec: meta?.durationSec ?? 0,
      genre: r.genreId,
    };
  });

  return NextResponse.json({ ok: true, genre, availableGenres: readyGenres, count: tracks.length, tracks });
}
