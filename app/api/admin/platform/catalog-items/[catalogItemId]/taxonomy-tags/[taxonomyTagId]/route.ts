import { NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { removeCatalogItemTaxonomyTag } from "@/lib/catalog-item-taxonomy-admin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ catalogItemId: string; taxonomyTagId: string }> };

/** Prefer path-based DELETE — query strings on DELETE are dropped or mishandled by some proxies/clients. */
export async function DELETE(_req: Request, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { catalogItemId, taxonomyTagId } = await ctx.params;
  const tagId = taxonomyTagId?.trim();
  if (!tagId) {
    return NextResponse.json({ error: "taxonomyTagId required" }, { status: 400 });
  }

  const exists = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  }

  const { deleted } = await removeCatalogItemTaxonomyTag(catalogItemId, tagId);
  if (deleted === 0) {
    return NextResponse.json(
      { error: "No link removed — tag may already be unassigned or id mismatch", deleted: 0 },
      { status: 404 },
    );
  }

  return NextResponse.json({ deleted });
}
