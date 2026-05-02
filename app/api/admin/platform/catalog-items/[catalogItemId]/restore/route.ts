import { NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ catalogItemId: string }> };

/** SUPER_ADMIN — clear archive flags (row visible in discovery again). */
export async function POST(_req: Request, ctx: RouteCtx) {
  if (!(await getSuperAdminOrNull())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { catalogItemId } = await ctx.params;
  if (!catalogItemId?.trim()) {
    return NextResponse.json({ error: "catalogItemId required" }, { status: 400 });
  }

  const row = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    select: { id: true, archivedAt: true },
  });
  if (!row) return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });

  await prisma.catalogItem.update({
    where: { id: catalogItemId },
    data: {
      archivedAt: null,
      archivedByUserId: null,
      archiveReason: null,
    },
  });

  return NextResponse.json({ ok: true });
}
