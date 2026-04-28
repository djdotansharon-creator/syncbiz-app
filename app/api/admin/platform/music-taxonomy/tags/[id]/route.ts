import { NextRequest, NextResponse } from "next/server";
import {
  assertNoTaxonomyCycles,
  parseMusicTaxonomyStatus,
  validatePatchBody,
} from "@/lib/music-taxonomy-admin";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET/PATCH /api/admin/platform/music-taxonomy/tags/[id]
 */

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;

  const tag = await prisma.musicTaxonomyTag.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, slug: true, labelEn: true } },
      mergedInto: { select: { id: true, slug: true, labelEn: true } },
    },
  });

  if (!tag) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ tag });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;

  const existing = await prisma.musicTaxonomyTag.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      status: true,
      parentId: true,
      mergedIntoId: true,
    },
  });

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validatePatchBody(raw);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const o = raw as Record<string, unknown>;

  let nextParentId = existing.parentId;
  if ("parentId" in o) {
    nextParentId =
      o.parentId === null ? null : typeof o.parentId === "string" ? o.parentId : nextParentId;
  }

  let nextMergedIntoId = existing.mergedIntoId;
  if ("mergedIntoId" in o) {
    nextMergedIntoId =
      o.mergedIntoId === null ? null : typeof o.mergedIntoId === "string" ? o.mergedIntoId : nextMergedIntoId;
  }

  let nextStatus = existing.status;
  if ("status" in o && typeof o.status === "string") {
    const parsed = parseMusicTaxonomyStatus(o.status);
    if (!parsed) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    nextStatus = parsed;
  }

  if (nextMergedIntoId === id) {
    return NextResponse.json({ error: "mergedIntoId cannot equal this tag" }, { status: 400 });
  }

  if (nextStatus === "MERGED" && !nextMergedIntoId) {
    return NextResponse.json({ error: "MERGED status requires mergedIntoId" }, { status: 400 });
  }

  if (nextParentId && !(await assertNoTaxonomyCycles(id, nextParentId))) {
    return NextResponse.json({ error: "Invalid parent (cycle risk)" }, { status: 400 });
  }

  try {
    const tag = await prisma.musicTaxonomyTag.update({
      where: { id },
      data: validated.data,
      include: {
        parent: { select: { id: true, slug: true, labelEn: true } },
        mergedInto: { select: { id: true, slug: true, labelEn: true } },
      },
    });
    return NextResponse.json({ tag });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update tag";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
