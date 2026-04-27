/**
 * POST /api/admin/platform/users/[id]/set-password
 *
 * Sets `User.passwordHash` directly (admin recovery). Does not go through
 * the email reset-token flow. Never logs the plaintext password — audit
 * metadata only stores length and whether the platform owner marked the
 * change as a temporary password (UX hint; storage is the same hash).
 *
 * V1: Same guard pattern as other platform user routes: `getSuperAdminOrNull()`,
 * transactional write of password + `PlatformAuditLog` row.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/password-utils";
import { extractClientIp, writePlatformAuditLog } from "@/lib/admin/platform-audit";

const MIN_LEN = 6;
const MAX_LEN = 128;

type Body = { newPassword?: unknown; temporary?: unknown };

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

  let body: Body;
  try {
    body = (await req.json().catch(() => ({}))) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.newPassword !== "string" || !body.newPassword) {
    return NextResponse.json({ error: "newPassword is required" }, { status: 400 });
  }
  const newPassword = body.newPassword;
  if (newPassword.length < MIN_LEN || newPassword.length > MAX_LEN) {
    return NextResponse.json(
      { error: `Password must be between ${MIN_LEN} and ${MAX_LEN} characters` },
      { status: 400 },
    );
  }

  const temporary = body.temporary === true;

  const ipAddress = extractClientIp(req);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
      if (!target) return { kind: "not_found" as const };

      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hashPassword(newPassword) },
        select: { id: true },
      });

      await writePlatformAuditLog(tx, {
        action: "user.set_password",
        actorUserId: admin.id,
        targetWorkspaceId: null,
        ipAddress,
        metadata: {
          targetUserId: target.id,
          targetEmail: target.email,
          passwordLength: newPassword.length,
          temporary,
        },
      });

      return { kind: "ok" as const, email: target.email };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, email: result.email }, { status: 200 });
  } catch (e) {
    console.error("[admin/platform/users/set-password] error:", e);
    return NextResponse.json({ error: "Failed to set password" }, { status: 500 });
  }
}
