import { NextRequest, NextResponse } from "next/server";
import { shadowAuthorize } from "@/lib/authz";
import { getCurrentUserFromCookies, hasBranchAccess } from "@/lib/auth-helpers";
import { getScheduleSwitch, setScheduleSwitch } from "@/lib/branch-schedule-switch";

/**
 * The branch's schedule switch (owner 2026-11-16). GET ?branchId=  → { enabled, switchable, branchId };  PUT { branchId, enabled: boolean } → the same, after saving.
 * Same rule as editing the branch's schedules: whoever has access to the branch (its owner / manager / its users) — never another branch's.
 */
async function guard(branchId: string) {
  const user = await getCurrentUserFromCookies();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  if (!user.tenantId?.trim()) return { error: NextResponse.json({ error: "Tenant context missing" }, { status: 400 }) } as const;
  const key = (branchId ?? "").trim() || "default";
  if (!(await hasBranchAccess(user.id, key, user.tenantId))) return { error: NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 }) } as const;
  return { user, key } as const;
}

export async function GET(req: NextRequest) {
  const g = await guard(req.nextUrl.searchParams.get("branchId") ?? "");
  if ("error" in g) return g.error;
  return NextResponse.json(await getScheduleSwitch(g.user.tenantId, g.key), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  let body: { branchId?: unknown; enabled?: unknown };
  try {
    body = (await req.json()) as { branchId?: unknown; enabled?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled (true | false) is required" }, { status: 400 });
  const g = await guard(typeof body.branchId === "string" ? body.branchId : "");
  if ("error" in g) return g.error;
  shadowAuthorize("schedules/switch:PUT", { userId: g.user.id, workspaceId: g.user.tenantId }, "schedule.edit", [g.key]); // Gate 3A shadow: log only, never blocks
  const saved = await setScheduleSwitch(g.user.tenantId, g.key, body.enabled);
  if (!saved) return NextResponse.json({ error: "This branch cannot be switched (it is not a branch of this business)" }, { status: 404 });
  return NextResponse.json(saved, { headers: { "Cache-Control": "no-store" } });
}
