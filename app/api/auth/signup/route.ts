import { NextRequest, NextResponse } from "next/server";
import { EntitlementLimitError } from "@/lib/entitlement-limits";
import { createWorkspaceOwner } from "@/lib/user-store";
const DEMO_TENANT_ID = "tnt-default";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      firstName?: string;
      lastName?: string;
      company?: string;
      email?: string;
      password?: string;
    };
    const firstName = (body.firstName ?? "").trim();
    const lastName = (body.lastName ?? "").trim();
    const company = (body.company ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    const ownerName = `${firstName} ${lastName}`.trim() || undefined;
    const workspaceName = company || "My Workspace";
    const created = await createWorkspaceOwner({
      email,
      password,
      workspaceName,
      ownerName,
    });
    if (created.tenant.id === DEMO_TENANT_ID) {
      return NextResponse.json({ error: "Signup isolation failure" }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      userId: created.user.id,
      accountId: created.tenant.id,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof EntitlementLimitError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    const msg = e instanceof Error ? e.message : "Signup failed";
    const duplicate = /already exists/i.test(msg);
    return NextResponse.json({ error: msg }, { status: duplicate ? 409 : 400 });
  }
}

