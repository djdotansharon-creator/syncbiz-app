import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import {
  addCatalogItemTaxonomyTag,
  listCatalogItemTaxonomyLinks,
  removeCatalogItemTaxonomyTag,
  replaceCatalogItemTaxonomyTags,
} from "@/lib/catalog-item-taxonomy-admin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ catalogItemId: string }> };

async function assertCatalogItemExists(catalogItemId: string): Promise<boolean> {
  const row = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    select: { id: true },
  });
  return !!row;
}

/**
 * GET — list taxonomy links + tag summaries for one CatalogItem.
 * PUT — replace full tag set `{ tagIds: string[] }`.
 * POST — add one `{ taxonomyTagId: string }`.
 */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { catalogItemId } = await ctx.params;
  if (!(await assertCatalogItemExists(catalogItemId))) {
    return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  }

  const links = await listCatalogItemTaxonomyLinks(catalogItemId);
  return NextResponse.json({
    links: links.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { catalogItemId } = await ctx.params;
  if (!(await assertCatalogItemExists(catalogItemId))) {
    return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as { tagIds?: unknown };
  if (!Array.isArray(body.tagIds) || body.tagIds.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "Expected { tagIds: string[] }" }, { status: 400 });
  }

  try {
    await replaceCatalogItemTaxonomyTags(catalogItemId, body.tagIds, admin.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update tags";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const links = await listCatalogItemTaxonomyLinks(catalogItemId);
  return NextResponse.json({
    links: links.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { catalogItemId } = await ctx.params;
  if (!(await assertCatalogItemExists(catalogItemId))) {
    return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as { taxonomyTagId?: unknown };
  if (typeof body.taxonomyTagId !== "string" || !body.taxonomyTagId.trim()) {
    return NextResponse.json({ error: "Expected { taxonomyTagId: string }" }, { status: 400 });
  }

  try {
    await addCatalogItemTaxonomyTag(catalogItemId, body.taxonomyTagId.trim(), admin.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to add tag";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { catalogItemId } = await ctx.params;
  if (!(await assertCatalogItemExists(catalogItemId))) {
    return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  }

  const taxonomyTagId = req.nextUrl.searchParams.get("taxonomyTagId")?.trim();
  if (!taxonomyTagId) {
    return NextResponse.json({ error: "Query taxonomyTagId required" }, { status: 400 });
  }

  const { deleted } = await removeCatalogItemTaxonomyTag(catalogItemId, taxonomyTagId);
  return NextResponse.json({ deleted });
}
