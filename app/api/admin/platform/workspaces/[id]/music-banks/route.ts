import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { privateBankById } from "@/lib/music-bank/private-banks";
import { closeTakesEffectAt, untilDateTakesEffectAt } from "@/lib/music-bank/day-boundary";
import { extractClientIp, writePlatformAuditLog } from "@/lib/admin/platform-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Every branch time zone of a business (no branches → UTC). */
async function branchTimeZones(workspaceId: string): Promise<string[]> {
  const rows = await prisma.branch.findMany({ where: { workspaceId }, select: { timezone: true } });
  const zones = [...new Set(rows.map((r) => (r.timezone ?? "").trim()).filter(Boolean))];
  return zones.length > 0 ? zones : ["UTC"];
}

/**
 * PUT /api/admin/platform/workspaces/[id]/music-banks — open or close one PRIVATE music bank for one business
 * (owner 2026-11-10). SUPER_ADMIN only. Body: { bankId, open: boolean, expiresAt?: "YYYY-MM-DD" | null }.
 *
 * 2026-11-11 (owner): "never cut the music in the middle of the day".
 *  - OPEN is immediate (and cancels a pending close).
 *  - CLOSE sets closesAt = the next 04:00 in the business's branch time (the latest branch, so none is cut before its own
 *    04:00). Until then the bank plays as before and the station shows a notice; then the station switches to its fallback
 *    music at a song boundary. Closing again while a close is pending keeps the original time.
 *  - An "until" date D means: plays through all of D, stops at 04:00 on the morning after (branch time).
 * The change and its platform audit row commit together.
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

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
  if (!ws) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const zones = await branchTimeZones(workspaceId);

  let expiresAt: Date | null = null;
  if (body.open && body.expiresAt != null && body.expiresAt !== "") {
    if (typeof body.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt)) {
      return NextResponse.json({ error: "expiresAt must be YYYY-MM-DD" }, { status: 400 });
    }
    expiresAt = untilDateTakesEffectAt(body.expiresAt, zones);
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "The end date must be in the future" }, { status: 400 });
    }
  }

  const ip = extractClientIp(req);
  const now = new Date();
  let closesAt: Date | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.musicBankGrant.findUnique({ where: { workspaceId_bankId: { workspaceId, bankId: bank.id } }, select: { closesAt: true } });
    if (body.open) {
      await tx.musicBankGrant.upsert({
        where: { workspaceId_bankId: { workspaceId, bankId: bank.id } },
        create: { workspaceId, bankId: bank.id, expiresAt, grantedByUserId: admin.id },
        update: { expiresAt, closesAt: null, closeReason: null, grantedByUserId: admin.id },
      });
    } else {
      if (!existing) return "noop" as const; // nothing to close
      // a close already pending keeps its original time (pressing off twice never moves it)
      closesAt = existing.closesAt && existing.closesAt.getTime() > now.getTime() ? existing.closesAt : closeTakesEffectAt(now, zones);
      if (existing.closesAt && existing.closesAt.getTime() <= now.getTime()) closesAt = existing.closesAt; // already closed
      await tx.musicBankGrant.update({
        where: { workspaceId_bankId: { workspaceId, bankId: bank.id } },
        data: { closesAt, closeReason: "manual" },
      });
    }
    await writePlatformAuditLog(tx, {
      action: body.open ? "music_bank.open" : "music_bank.close",
      actorUserId: admin.id,
      targetWorkspaceId: workspaceId,
      metadata: {
        bankId: bank.id,
        bankName: bank.name,
        expiresAt: expiresAt?.toISOString() ?? null,
        closesAt: (closesAt as Date | null)?.toISOString() ?? null,
        branchTimeZones: zones,
      },
      ipAddress: ip,
    });
    return "ok" as const;
  });

  const grant = await prisma.musicBankGrant.findUnique({
    where: { workspaceId_bankId: { workspaceId, bankId: bank.id } },
    select: { bankId: true, expiresAt: true, closesAt: true, closeReason: true, createdAt: true },
  });
  return NextResponse.json({
    ok: true,
    noop: result === "noop",
    grant: grant
      ? {
          bankId: grant.bankId,
          expiresAt: grant.expiresAt?.toISOString() ?? null,
          closesAt: grant.closesAt?.toISOString() ?? null,
          closeReason: grant.closeReason,
          since: grant.createdAt.toISOString(),
        }
      : null,
  });
}
