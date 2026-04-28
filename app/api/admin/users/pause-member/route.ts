/**
 * Soft-pauses a user's membership in the acting admin's workspace
 * (`WorkspaceMember.status = SUSPENDED`). The user's global `User` row,
 * password and other workspace memberships are untouched.
 *
 * Distinct from:
 *   - `DELETE /api/admin/users` — global login disable (sets `User.status`).
 *   - `POST /api/admin/users/remove-member` — removes the workspace member
 *     row (irreversible).
 *
 * Pair with `POST /api/admin/users/resume-member` to re-activate.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import { pauseMembershipInWorkspace } from "@/lib/user-store";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!admin.tenantId?.trim()) {
    return NextResponse.json({ error: "Admin tenant context missing" }, { status: 400 });
  }

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const outcome = await pauseMembershipInWorkspace({
    email,
    tenantId: admin.tenantId.trim(),
    actingUserId: admin.id,
  });

  if (!outcome.ok) {
    switch (outcome.reason) {
      case "not_found":
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      case "wrong_workspace":
        return NextResponse.json({ error: "User is not in your workspace" }, { status: 404 });
      case "self":
        return NextResponse.json(
          { error: "Cannot pause your own membership", code: "CANNOT_PAUSE_SELF" },
          { status: 400 },
        );
      case "workspace_owner":
        return NextResponse.json(
          { error: "Cannot pause the workspace owner", code: "CANNOT_PAUSE_OWNER" },
          { status: 403 },
        );
      case "last_admin":
        return NextResponse.json(
          {
            error: "Cannot pause the last active workspace admin",
            code: "CANNOT_PAUSE_LAST_ADMIN",
          },
          { status: 400 },
        );
      default:
        return NextResponse.json({ error: "Cannot pause user" }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, userId: outcome.userId, email: outcome.email }, { status: 200 });
}
