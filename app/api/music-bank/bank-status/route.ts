import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { bankStatusForWorkspace } from "@/lib/music-bank/bank-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/music-bank/bank-status — the signed-in person's business: its private banks that are open, closing (notice) or
 * closed within the last week, and its fallback playlist (owner 2026-11-11). Read by the station's renderer guard
 * (components/private-bank-guard.tsx) and the notice pill. Names + times only — never a song list.
 */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const status = await bankStatusForWorkspace(user.tenantId ?? null);
  return NextResponse.json({ ...status, now: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
