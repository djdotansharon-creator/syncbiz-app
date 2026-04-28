import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import {
  parseMusicTaxonomyCategory,
  parseMusicTaxonomyStatus,
  queryMusicTaxonomyTags,
  validateCreateBody,
} from "@/lib/music-taxonomy-admin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/platform/music-taxonomy/tags
 * POST /api/admin/platform/music-taxonomy/tags
 *
 * Platform `SUPER_ADMIN` only — global music intelligence dictionary.
 */

export async function GET(req: NextRequest) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const catRaw = sp.get("category");
  const statRaw = sp.get("status");
  const category = catRaw ? parseMusicTaxonomyCategory(catRaw) : null;
  const status = statRaw ? parseMusicTaxonomyStatus(statRaw) : null;
  const q = sp.get("q")?.trim() ?? "";

  if (catRaw && !category) {
    return NextResponse.json({ error: "Invalid category filter" }, { status: 400 });
  }
  if (statRaw && !status) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const tags = await queryMusicTaxonomyTags({
    category: category ?? undefined,
    status: status ?? undefined,
    q: q || undefined,
  });

  return NextResponse.json({ tags });
}

export async function POST(req: NextRequest) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateCreateBody(raw);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const tag = await prisma.musicTaxonomyTag.create({
      data: validated.data,
      include: {
        parent: { select: { id: true, slug: true, labelEn: true } },
        mergedInto: { select: { id: true, slug: true, labelEn: true } },
      },
    });
    return NextResponse.json({ tag });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create tag";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
