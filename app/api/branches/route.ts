import { NextResponse } from "next/server";
import { EntitlementLimitError } from "@/lib/entitlement-limits";
import { db } from "@/lib/store";
import { getCurrentUserFromCookies, getAccessTypeForUser } from "@/lib/auth-helpers";
import { NextRequest } from "next/server";

function resolveAccountScope(userTenantId: string): string {
  return userTenantId === "tnt-default" ? "acct-demo-001" : userTenantId;
}

export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = resolveAccountScope(user.tenantId);
  const existing = await db.getBranches(accountId);
  if (existing.length > 0) {
    return NextResponse.json(existing);
  }
  return NextResponse.json([
    {
      id: "default",
      accountId,
      name: "Default",
      code: "DEFAULT",
      timezone: "America/New_York",
      city: "",
      country: "",
      status: "active",
      devicesOnline: 0,
      devicesTotal: 0,
    },
  ]);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accessType = await getAccessTypeForUser(user.id);
  if (accessType !== "OWNER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as { id?: string; name?: string; timezone?: string };
    const name = (body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const branch = await db.addBranch({
      accountId: resolveAccountScope(user.tenantId),
      id: (body.id ?? "").trim() || undefined,
      name,
      timezone: (body.timezone ?? "").trim() || undefined,
    });
    return NextResponse.json(branch, { status: 201 });
  } catch (e) {
    if (e instanceof EntitlementLimitError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    const message = e instanceof Error ? e.message : "Failed to create branch";
    const status = /already exists/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

