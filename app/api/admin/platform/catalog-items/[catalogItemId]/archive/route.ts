import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ catalogItemId: string }> };

/** SUPER_ADMIN — soft-remove from discovery (playlists unchanged). */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { catalogItemId } = await ctx.params;
  if (!catalogItemId?.trim()) {
    return NextResponse.json({ error: "catalogItemId required" }, { status: 400 });
  }

  let reason: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
    if (typeof body.reason === "string") {
      const t = body.reason.trim();
      reason = t.length > 0 ? t.slice(0, 4000) : null;
    }
  } catch {
    reason = null;
  }

  const row = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    select: { id: true, archivedAt: true },
  });
  if (!row) return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  if (row.archivedAt) {
    return NextResponse.json({ ok: true, alreadyArchived: true });
  }

  await prisma.catalogItem.update({
    where: { id: catalogItemId },
    data: {
      archivedAt: new Date(),
      archivedByUserId: admin.id,
      archiveReason: reason,
    },
  });

  return NextResponse.json({ ok: true });
}
