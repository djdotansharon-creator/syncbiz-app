/**
 * Stage 2 – Admin user management.
 * V1: OWNER and BRANCH_USER only. Requires OWNER (TENANT_OWNER/TENANT_ADMIN).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import { createUser, listUsers } from "@/lib/user-store";
import type { TenantRole, BranchRole } from "@/lib/user-types";

const DEFAULT_BRANCH_ID = "default";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const users = await listUsers();
    return NextResponse.json(users);
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
    const email = typeof body.email === "string" ? body.email.trim() : "";
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
    const branchAssignments =
      accessType === "OWNER"
        ? [{ branchId: DEFAULT_BRANCH_ID, role: branchRole }]
        : rawBranchIds.length > 0
          ? rawBranchIds
              .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
              .map((branchId) => ({
                branchId: branchId.trim() || DEFAULT_BRANCH_ID,
                role: branchRole,
              }))
          : [{ branchId: DEFAULT_BRANCH_ID, role: branchRole }];

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    if (accessType !== "OWNER" && accessType !== "BRANCH_USER") {
      return NextResponse.json({ error: "accessType must be OWNER or BRANCH_USER" }, { status: 400 });
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
    const isDuplicate = /already exists/i.test(msg);
    return NextResponse.json(
      { error: msg },
      { status: isDuplicate ? 409 : 400 }
    );
  }
}
