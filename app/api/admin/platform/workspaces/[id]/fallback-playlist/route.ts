import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { extractClientIp, writePlatformAuditLog } from "@/lib/admin/platform-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PUT /api/admin/platform/workspaces/[id]/fallback-playlist — the business's FALLBACK MUSIC (owner 2026-11-11): what its
 * station plays instead of a private bank that closed (at the 04:00 after the close). SUPER_ADMIN only.
 * Body: { playlistId: string | null } — null = the default (a general mix of the public Royalty-Free catalog).
 * The playlist must belong to that business. The change and its audit row commit together.
 */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id: workspaceId } = await context.params;

  let body: { playlistId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const playlistId = body.playlistId == null || body.playlistId === "" ? null : typeof body.playlistId === "string" ? body.playlistId : undefined;
  if (playlistId === undefined) return NextResponse.json({ error: "playlistId must be a string or null" }, { status: 400 });

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, fallbackPlaylistId: true } });
  if (!ws) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  let playlistName: string | null = null;
  if (playlistId) {
    const pl = await prisma.playlist.findFirst({ where: { id: playlistId, workspaceId }, select: { name: true } });
    if (!pl) return NextResponse.json({ error: "That playlist does not belong to this business" }, { status: 400 });
    playlistName = pl.name;
  }

  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id: workspaceId }, data: { fallbackPlaylistId: playlistId } });
    await writePlatformAuditLog(tx, {
      action: "workspace.fallback_playlist",
      actorUserId: admin.id,
      targetWorkspaceId: workspaceId,
      metadata: { from: ws.fallbackPlaylistId, to: playlistId, playlistName },
      ipAddress: extractClientIp(req),
    });
  });
  return NextResponse.json({ ok: true, fallbackPlaylistId: playlistId });
}
