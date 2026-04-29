import { NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import {
  loadSourceMetadataSuggestionsForSnapshot,
  refreshCatalogSourceSnapshot,
  serializeCatalogSourceSnapshot,
} from "@/lib/catalog-source-refresh";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ catalogItemId: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { catalogItemId } = await ctx.params;

  const exists = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  }

  let snapshot;
  try {
    snapshot = await refreshCatalogSourceSnapshot(catalogItemId);
  } catch (e) {
    if (e instanceof Error && e.message === "Catalog item not found") {
      return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
    }
    const msg = e instanceof Error ? e.message : "Refresh failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { metadataSuggestions, unknownCues } =
    await loadSourceMetadataSuggestionsForSnapshot(catalogItemId, snapshot);

  return NextResponse.json({
    snapshot: serializeCatalogSourceSnapshot(snapshot),
    metadataSuggestions,
    unknownCues,
  });
}
