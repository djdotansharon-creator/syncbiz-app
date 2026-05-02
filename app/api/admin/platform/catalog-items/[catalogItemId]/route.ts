import { NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ catalogItemId: string }> };

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { catalogItemId } = await ctx.params;
  if (!catalogItemId?.trim()) {
    return NextResponse.json({ error: "catalogItemId required" }, { status: 400 });
  }

  const exists = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  }

  const playlistIdsRows = await prisma.playlistItem.findMany({
    where: { catalogId: catalogItemId },
    select: { playlistId: true },
    distinct: ["playlistId"],
  });
  const playlistIds = playlistIdsRows.map((r) => r.playlistId);

  const [playlistUsageCount, scheduleRefsCount, analyticsRow] = await Promise.all([
    prisma.playlistItem.count({ where: { catalogId: catalogItemId } }),
    playlistIds.length === 0
      ? Promise.resolve(0)
      : prisma.schedule.count({ where: { playlistId: { in: playlistIds } } }),
    prisma.catalogAnalytics.findUnique({
      where: { catalogItemId },
      select: { playCount: true, sharedCount: true, aiDjCount: true },
    }),
  ]);

  const plays = analyticsRow?.playCount ?? 0;
  const shares = analyticsRow?.sharedCount ?? 0;
  const aiDj = analyticsRow?.aiDjCount ?? 0;

  if (playlistUsageCount > 0 || scheduleRefsCount > 0 || plays > 0 || shares > 0 || aiDj > 0) {
    const distinctPlaylistCount = playlistIds.length;
    const parts: string[] = [];
    if (playlistUsageCount > 0) {
      parts.push(
        `${playlistUsageCount} playlist item link(s)${
          distinctPlaylistCount > 0 ? ` · ${distinctPlaylistCount} playlist(s)` : ""
        }`,
      );
    }
    if (scheduleRefsCount > 0) parts.push(`${scheduleRefsCount} schedule row(s)`);
    if (plays > 0) parts.push(`${plays} analytics play(s)`);
    if (shares > 0) parts.push(`${shares} share signal(s)`);
    if (aiDj > 0) parts.push(`${aiDj} AI DJ signal(s)`);
    const summary = parts.join(" · ");
    return NextResponse.json(
      {
        error: "Catalog item is in use",
        summary,
      },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.playlist.updateMany({
      where: { catalogItemId },
      data: { catalogItemId: null },
    });
    await tx.catalogItem.delete({ where: { id: catalogItemId } });
  });

  return NextResponse.json({ ok: true });
}
