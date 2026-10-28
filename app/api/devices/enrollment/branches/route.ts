import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { searchBranchesForEnrollment } from "@/lib/device-enrollment-store";

/**
 * Device enrollment — the branch suggestions a not-yet-approved device sees while it types a branch name (owner 2026-10-28). GET ?q=…
 * Only branches whose name contains what was typed, never the whole list and nothing before the first letter; only {id, name, city}. Empty while enrollment is off.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  const ws = (user?.tenantId ?? "").trim();
  if (!user || !ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const items = await searchBranchesForEnrollment(ws, q);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[device-enrollment] branch search failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
