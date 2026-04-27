/**
 * Stage 2 – Admin user management.
 * V1: OWNER and BRANCH_USER only. Requires OWNER (TENANT_OWNER/TENANT_ADMIN).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import { createUser, getUserByEmail, listUsersWithScopeForTenant, updateUser, disableUserInWorkspace } from "@/lib/user-store";
import { db } from "@/lib/store";
import type { TenantRole, BranchRole } from "@/lib/user-types";

const DEFAULT_BRANCH_ID = "default";

function resolveAccountScope(userTenantId: string): string {
  // Keep consistent with other route implementations.
  return userTenantId === "tnt-default" ? "acct-demo-001" : userTenantId;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await listUsersWithScopeForTenant(admin.tenantId), { status: 200 });
  } catch (e) {
    console.error("[api/admin/users] GET error:", e);
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    if (!admin.tenantId?.trim()) {
      return NextResponse.json({ error: "Admin tenant context missing" }, { status: 400 });
    }
    const body = (await req.json()) as {
      email?: string;
      password?: string;
      accessType?: string;
      branchIds?: string[];
    };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const accessType = (body.accessType ?? "BRANCH_USER") as "OWNER" | "BRANCH_USER";

    let tenantRole: TenantRole;
    const branchRole: BranchRole = "BRANCH_CONTROLLER";

    if (accessType === "OWNER") {
      tenantRole = "TENANT_OWNER";
    } else {
      tenantRole = "TENANT_MEMBER";
    }

    const rawBranchIds = Array.isArray(body.branchIds) ? body.branchIds : [];
    const filteredBranchIds = rawBranchIds
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim());

    // Empty branch list is allowed: create with default "default" row in store, then admin assigns in UI.
    const branchAssignments =
      accessType === "OWNER"
        ? [{ branchId: DEFAULT_BRANCH_ID, role: branchRole }]
        : filteredBranchIds.map((branchId) => ({
            branchId,
            role: branchRole,
          }));

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    if (accessType !== "OWNER" && accessType !== "BRANCH_USER") {
      return NextResponse.json({ error: "accessType must be OWNER or BRANCH_USER" }, { status: 400 });
    }

    // Workspace isolation for duplicates:
    // - If the email exists in another tenant: deny with 403.
    // - If it exists in the same tenant: return 409 with a dedicated code so UI can switch to edit mode.
    const existing = await getUserByEmail(email);
    if (existing) {
      if (existing.tenantId !== admin.tenantId.trim()) {
        return NextResponse.json(
          { error: "Forbidden: user email exists in another workspace" },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: "User already exists", code: "USER_EXISTS" },
        { status: 409 }
      );
    }

    // Prevent cross-tenant branch assignment (workspace isolation).
    // For backward compatibility, we always allow the synthetic "default" branchId.
    if (accessType === "BRANCH_USER") {
      const accountId = resolveAccountScope(admin.tenantId.trim());
      const tenantBranches = await db.getBranches(accountId);
      const allowed = new Set(tenantBranches.map((b) => b.id));
      const invalid = branchAssignments
        .map((a) => a.branchId)
        .filter((bid) => bid !== DEFAULT_BRANCH_ID && !allowed.has(bid));

      if (invalid.length > 0) {
        console.warn("[api/admin/users] Reject cross-tenant branch assignment", {
          tenantId: admin.tenantId,
          invalidBranchIds: Array.from(new Set(invalid)),
        });
        return NextResponse.json(
          { error: "Forbidden: one or more branches are not in your workspace" },
          { status: 403 }
        );
      }
    }

    const user = await createUser({
      email,
      password,
      tenantRole,
      branchAssignments,
      tenantId: admin.tenantId.trim(),
    });
    return NextResponse.json(user, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create user";
    const status = /already exists/i.test(msg) ? 409 : 400;
    return NextResponse.json({ error: msg, code: status === 409 ? "USER_EXISTS" : undefined }, { status });
  }
}

/**
 * Soft-disable a user. Phase-1 user-management integrity fix.
 *
 * - No hard delete. The User row is preserved.
 * - Sets `User.status = DISABLED` and `User.deactivatedAt = now()`.
 * - WorkspaceMember and UserBranchAssignment rows are kept so the admin
 *   list still shows the row and a future reactivate is one update.
 * - Refuses to disable: self / SUPER_ADMIN / workspace owner / last admin.
 */
export async function DELETE(req: NextRequest) {
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

  const outcome = await disableUserInWorkspace({
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
        return NextResponse.json({ error: "You cannot disable yourself", code: "CANNOT_DISABLE_SELF" }, { status: 400 });
      case "super_admin":
        return NextResponse.json({ error: "Cannot disable a platform super admin", code: "CANNOT_DISABLE_SUPER_ADMIN" }, { status: 403 });
      case "workspace_owner":
        return NextResponse.json({ error: "Cannot disable the workspace owner", code: "CANNOT_DISABLE_OWNER" }, { status: 403 });
      case "last_admin":
        return NextResponse.json({ error: "Cannot disable the last workspace admin", code: "CANNOT_DISABLE_LAST_ADMIN" }, { status: 400 });
      default:
        return NextResponse.json({ error: "Cannot disable user" }, { status: 400 });
    }
  }

  return NextResponse.json(
    { ok: true, userId: outcome.userId, email: outcome.email, status: "DISABLED" },
    { status: 200 },
  );
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    if (!admin.tenantId?.trim()) {
      return NextResponse.json({ error: "Admin tenant context missing" }, { status: 400 });
    }

    const body = (await req.json()) as {
      email?: string;
      name?: string;
      accessType?: string;
      branchIds?: string[];
      newPassword?: string;
    };

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name : undefined;
    const newPassword =
      typeof body.newPassword === "string" && body.newPassword.length > 0
        ? body.newPassword
        : undefined;
    const accessType = (body.accessType ?? "BRANCH_USER") as "OWNER" | "BRANCH_USER";

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    if (accessType !== "OWNER" && accessType !== "BRANCH_USER") {
      return NextResponse.json({ error: "accessType must be OWNER or BRANCH_USER" }, { status: 400 });
    }

    const tenantRole: TenantRole = accessType === "OWNER" ? "TENANT_OWNER" : "TENANT_MEMBER";
    const branchRole: BranchRole = "BRANCH_CONTROLLER";
    const rawBranchIds = Array.isArray(body.branchIds) ? body.branchIds : [];
    const filteredBranchIds = rawBranchIds
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim());

    if (accessType === "BRANCH_USER" && filteredBranchIds.length === 0) {
      return NextResponse.json(
        { error: "branchIds are required for BRANCH_USER" },
        { status: 400 },
      );
    }

    const branchAssignments: Array<{ branchId: string; role: BranchRole }> =
      accessType === "OWNER"
        ? [{ branchId: DEFAULT_BRANCH_ID, role: branchRole }]
        : filteredBranchIds.map((branchId) => ({
            branchId,
            role: branchRole,
          }));

    // Validate branch IDs for BRANCH_USER edits.
    if (accessType === "BRANCH_USER") {
      const accountId = resolveAccountScope(admin.tenantId.trim());
      const tenantBranches = await db.getBranches(accountId);
      const allowed = new Set(tenantBranches.map((b) => b.id));
      const invalid = branchAssignments
        .map((a) => a.branchId)
        .filter((bid) => bid !== DEFAULT_BRANCH_ID && !allowed.has(bid));

      if (invalid.length > 0) {
        console.warn("[api/admin/users] Reject cross-tenant branch assignment (PATCH)", {
          tenantId: admin.tenantId,
          invalidBranchIds: Array.from(new Set(invalid)),
        });
        return NextResponse.json(
          { error: "Forbidden: one or more branches are not in your workspace" },
          { status: 403 }
        );
      }
    }

    // updateUser() enforces tenant match.
    const updated = await updateUser({
      email,
      name,
      newPassword,
      tenantId: admin.tenantId.trim(),
      tenantRole,
      branchAssignments,
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update user";
    const status = /forbidden/i.test(msg) ? 403 : /not found|User not found/i.test(msg) ? 404 : 400;
    return NextResponse.json({ error: msg, code: status === 403 ? "FORBIDDEN" : undefined }, { status });
  }
}
