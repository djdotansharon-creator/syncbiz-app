/**
 * POST /api/admin/platform/users/[id]/enable
 *
 * Platform-admin (`SUPER_ADMIN`) action: re-enable a globally disabled
 * user. Sets `User.status = "ACTIVE"` and clears `deactivatedAt`.
 *
 * Mirror of the disable route. Already-active is a no-op (200, no
 * audit row).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { extractClientIp, writePlatformAuditLog } from "@/lib/admin/platform-audit";

const MAX_REASON_LENGTH = 500;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getSuperAdminOrNull();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: userId } = await params;
  if (!userId?.trim()) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  let reason: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
    if (typeof body.reason === "string") {
      const trimmed = body.reason.trim();
      if (trimmed.length > MAX_REASON_LENGTH) {
        return NextResponse.json(
          { error: `Reason must be ${MAX_REASON_LENGTH} characters or less` },
          { status: 400 },
        );
      }
      reason = trimmed.length > 0 ? trimmed : null;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ipAddress = extractClientIp(req);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, status: true },
      });
      if (!target) return { kind: "not_found" as const };

      if (target.role === "SUPER_ADMIN") {
        // Symmetric guard with disable: SUPER_ADMIN status changes
        // happen out-of-band only. Avoids accidental "enable" calls
        // touching a user that was never disabled here.
        return { kind: "is_super_admin" as const };
      }
      if (target.status === "ACTIVE") {
        return { kind: "already_active" as const, target };
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          status: "ACTIVE",
          deactivatedAt: null,
        },
        select: { id: true, email: true, status: true },
      });

      await writePlatformAuditLog(tx, {
        action: "user.platform_enable",
        actorUserId: admin.id,
        targetWorkspaceId: null,
        ipAddress,
        metadata: {
          targetUserId: target.id,
          targetEmail: target.email,
          previousStatus: target.status,
          reason,
        },
      });

      return { kind: "ok" as const, user: updated };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (result.kind === "is_super_admin") {
      return NextResponse.json(
        { error: "Cannot toggle SUPER_ADMIN status from this endpoint" },
        { status: 403 },
      );
    }
    if (result.kind === "already_active") {
      return NextResponse.json(
        { ok: true, alreadyActive: true, user: result.target },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, user: result.user }, { status: 200 });
  } catch (e) {
    console.error("[admin/platform/users/enable] error:", e);
    return NextResponse.json({ error: "Failed to enable user" }, { status: 500 });
  }
}
