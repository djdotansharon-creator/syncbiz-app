/**
 * POST /api/admin/platform/users/[id]/disable
 *
 * Platform-admin (`SUPER_ADMIN`) action: globally disable a user across
 * the entire platform. Sets `User.status = "DISABLED"` and stamps
 * `deactivatedAt`.
 *
 * Effects (verified in `lib/auth.ts::validateCredentialsAsync` and
 * `lib/user-store.ts::getUserByEmail`):
 * - Login is blocked at `validateCredentialsAsync` line 35.
 * - Existing sessions resolve to `null` because `getUserByEmail`
 *   filters disabled users; the next request is treated as
 *   unauthenticated and the middleware redirects to /login.
 *
 * Distinct from the workspace-scoped `disableUserInWorkspace` (used by
 * Access Control / `/api/admin/users` PATCH): that drops a single
 * membership; this severs platform access entirely.
 *
 * Hard guards (server-side, mirrored in the UI for clarity):
 * - Cannot disable a `SUPER_ADMIN` (would lock the platform owner out).
 * - Cannot disable yourself.
 * - Already-disabled is a no-op (200, no audit row).
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

  if (userId === admin.id) {
    return NextResponse.json(
      { error: "You cannot disable your own platform account" },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, status: true },
      });
      if (!target) return { kind: "not_found" as const };

      if (target.role === "SUPER_ADMIN") {
        return { kind: "is_super_admin" as const };
      }
      if (target.status === "DISABLED") {
        return { kind: "already_disabled" as const, target };
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          status: "DISABLED",
          deactivatedAt: new Date(),
        },
        select: { id: true, email: true, status: true, deactivatedAt: true },
      });

      await writePlatformAuditLog(tx, {
        action: "user.platform_disable",
        actorUserId: admin.id,
        // User-scope action — no single workspace is the "target". The
        // /admin/platform/audit reader surfaces the user info from the
        // metadata, not from `targetWorkspaceId`.
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
        { error: "Cannot disable a SUPER_ADMIN. Change their role in DB first if intentional." },
        { status: 403 },
      );
    }
    if (result.kind === "already_disabled") {
      return NextResponse.json(
        { ok: true, alreadyDisabled: true, user: result.target },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, user: result.user }, { status: 200 });
  } catch (e) {
    console.error("[admin/platform/users/disable] error:", e);
    return NextResponse.json({ error: "Failed to disable user" }, { status: 500 });
  }
}
