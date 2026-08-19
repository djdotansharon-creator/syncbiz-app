import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { createWsToken } from "@/lib/auth-ws-token";
import { getAuthorizedBranchIds } from "@/lib/user-store";

/** Returns short-lived token for WS REGISTER. Requires authenticated session. Uses stable userId. */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Authoritative branch claim, computed from the user's DB authorization — never from the client.
    const authorizedBranches = await getAuthorizedBranchIds(user.id, user.tenantId);
    const token = createWsToken(user.id, { workspaceId: user.tenantId, authorizedBranches });
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: "Token creation failed" }, { status: 500 });
  }
}
