import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

/**
 * Activity log. Security hotfix (2026-10-11): signed-in only. The log is a process-local list with no writers today;
 * if entries are ever written again they must carry a workspace and be filtered to the caller's workspace here.
 */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(db.getLogs());
}
