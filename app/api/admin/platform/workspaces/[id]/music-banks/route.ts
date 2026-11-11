import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { privateBankById } from "@/lib/music-bank/private-banks";
import { extractClientIp, writePlatformAuditLog } from "@/lib/admin/platform-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PUT /api/admin/platform/workspaces/[id]/music-banks — open or close one PRIVATE music bank for one business
 * (owner 2026-11-10). SUPER_ADMIN only. Body: { bankId, open: boolean, expiresAt?: "YYYY-MM-DD" | null }.
 * The change and its platform audit row commit together. Closing deletes the grant (the audit log keeps the history).
 */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id: workspaceId } = await context.params;

  let body: { bankId?: unknown; open?: unknown; expiresAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const bank = typeof body.bankId === "string" ? privateBankById(body.bankId) : null;
  if (!bank) return NextResponse.json({ error: "Unknown bank" }, { status: 400 });
  if (typeof body.open !== "boolean") return NextResponse.json({ error: "open must be true or false" }, { status: 400 });

  let expiresAt: Date | null = null;
  if (body.open && body.expiresAt != null && body.expiresAt !== "") {
    if (typeof body.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt)) {
      return NextResponse.json({ error: "expiresAt must be YYYY-MM-DD" }, { status: 400 });
    }
    // the chosen day is included: access ends at the end of that day (UTC)
    expiresAt = new Date(`${body.expiresAt}T23:59:59.999Z`);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "The end date must be in the future" }, { status: 400 });
    }
  }

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
  if (!ws) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const ip = extractClientIp(req);
  await prisma.$transaction(async (tx) => {
    if (body.open) {
      await tx.musicBankGrant.upsert({
        where: { workspaceId_bankId: { workspaceId, bankId: bank.id } },
        create: { workspaceId, bankId: bank.id, expiresAt, grantedByUserId: admin.id },
        update: { expiresAt, grantedByUserId: admin.id },
      });
    } else {
      await tx.musicBankGrant.deleteMany({ where: { workspaceId, bankId: bank.id } });
    }
    await writePlatformAuditLog(tx, {
      action: body.open ? "music_bank.open" : "music_bank.close",
      actorUserId: admin.id,
      targetWorkspaceId: workspaceId,
      metadata: { bankId: bank.id, bankName: bank.name, expiresAt: expiresAt?.toISOString() ?? null },
      ipAddress: ip,
    });
  });

  const grant = await prisma.musicBankGrant.findUnique({ where: { workspaceId_bankId: { workspaceId, bankId: bank.id } }, select: { bankId: true, expiresAt: true, createdAt: true } });
  return NextResponse.json({ ok: true, grant: grant ? { bankId: grant.bankId, expiresAt: grant.expiresAt?.toISOString() ?? null, since: grant.createdAt.toISOString() } : null });
}
