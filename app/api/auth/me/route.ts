import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getAccessType, getAssignedBranchIds } from "@/lib/user-store";

/** Returns current user from session. V1 public shape: accessType, accountId, branchIds. */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ email: null, userId: null }, { status: 200 });
  }
  const [accessType, branchIds] = await Promise.all([
    getAccessType(user.id),
    getAssignedBranchIds(user.id),
  ]);
  return NextResponse.json({
    email: user.email,
    userId: user.id,
    accountId: user.tenantId,
    tenantId: user.tenantId,
    accessType,
    branchIds,
  });
}
