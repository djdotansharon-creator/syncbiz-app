import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import {
  refreshCatalogSourceSnapshot,
  shouldAttemptYouTubeCatalogSnapshot,
} from "@/lib/catalog-source-refresh";
import { prisma } from "@/lib/prisma";
import { catalogDiscoveryActiveWhere } from "@/lib/catalog-discovery-scope";

export const dynamic = "force-dynamic";

/**
 * SUPER_ADMIN — bounded batch refresh for catalog rows whose latest snapshot is not SUCCESS/PARTIAL.
 * YouTube-eligible rows only; does not replace per-item manual refresh.
 */
export async function POST(req: NextRequest) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let limit = 20;
  try {
    const body = (await req.json().catch(() => ({}))) as { limit?: unknown };
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.min(50, Math.max(1, Math.floor(body.limit)));
    }
  } catch {
    /* ignore */
  }

  const candidates = await prisma.catalogItem.findMany({
    where: {
      AND: [
        catalogDiscoveryActiveWhere,
        {
          OR: [
            { videoId: { not: null } },
            { url: { contains: "youtube.com", mode: "insensitive" } },
            { url: { contains: "youtu.be", mode: "insensitive" } },
          ],
        },
      ],
    },
    select: { id: true, url: true, provider: true, videoId: true },
    orderBy: { updatedAt: "desc" },
    take: Math.min(400, limit * 25),
  });

  const results: Array<{ catalogItemId: string; ok: boolean; detail?: string }> = [];

  for (const row of candidates) {
    if (results.length >= limit) break;
    if (!shouldAttemptYouTubeCatalogSnapshot(row)) continue;

    const latest = await prisma.catalogSourceSnapshot.findFirst({
      where: { catalogItemId: row.id },
      orderBy: { fetchedAt: "desc" },
      select: { fetchStatus: true },
    });
    if (latest?.fetchStatus === "SUCCESS" || latest?.fetchStatus === "PARTIAL") continue;

    try {
      await refreshCatalogSourceSnapshot(row.id);
      results.push({ catalogItemId: row.id, ok: true });
    } catch (e) {
      results.push({
        catalogItemId: row.id,
        ok: false,
        detail: e instanceof Error ? e.message : "refresh failed",
      });
    }
  }

  return NextResponse.json({
    requestedLimit: limit,
    attempted: results.length,
    results,
    note:
      "YouTube-only intake; append-only snapshots. Other providers are unchanged (no centralized metadata in V1). Use per-item Refresh for overrides.",
  });
}
