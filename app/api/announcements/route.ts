import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

/**
 * Legacy announcements list. Security hotfix (2026-10-11):
 *  GET  → signed-in only, and ONLY the caller's own workspace (same account mapping as /api/devices).
 *  POST → closed (405): it was unauthenticated, wrote to a fake "system" workspace and had no caller in the app.
 *         Jingles use the authenticated /api/jingles/library.
 */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = user.tenantId === "tnt-default" ? "acct-demo-001" : user.tenantId;
  return NextResponse.json(await db.getAnnouncements(accountId));
}

export async function POST() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405, headers: { Allow: "GET" } });
}
