import { NextResponse } from "next/server";
import { getCurrentUserFromCookies, getAccessTypeForUser } from "@/lib/auth-helpers";
import { db } from "@/lib/store";

/** Same account-scope rule as /api/branches. */
function resolveAccountScope(userTenantId: string): string {
  return userTenantId === "tnt-default" ? "acct-demo-001" : userTenantId;
}

/**
 * Control Room branch management guard: signed in + OWNER of the active workspace (same rule as POST /api/branches).
 * Returns the user and the workspace id every query must be scoped to.
 */
export async function requireBranchManager(): Promise<
  { ok: true; userId: string; workspaceId: string } | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUserFromCookies();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const accessType = await getAccessTypeForUser(user.id, user.tenantId);
  if (accessType !== "OWNER") return { ok: false, response: NextResponse.json({ error: "Only the owner can manage branches." }, { status: 403 }) };
  const workspaceId = await db.resolveWorkspaceIdForAccount(resolveAccountScope(user.tenantId));
  if (!workspaceId) return { ok: false, response: NextResponse.json({ error: "Workspace not found" }, { status: 404 }) };
  return { ok: true, userId: user.id, workspaceId };
}
