import { NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import {
  loadSourceMetadataSuggestionsForSnapshot,
  serializeCatalogSourceSnapshot,
} from "@/lib/catalog-source-refresh";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ catalogItemId: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { catalogItemId } = await ctx.params;

  const row = await prisma.catalogSourceSnapshot.findFirst({
    where: { catalogItemId },
    orderBy: { fetchedAt: "desc" },
  });

  if (!row) {
    return NextResponse.json({ snapshot: null, metadataSuggestions: [], unknownCues: [] });
  }

  const { metadataSuggestions, unknownCues } =
    await loadSourceMetadataSuggestionsForSnapshot(catalogItemId, row);

  return NextResponse.json({
    snapshot: serializeCatalogSourceSnapshot(row),
    metadataSuggestions,
    unknownCues,
  });
}
