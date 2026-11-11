import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { accessiblePrivateBanks } from "@/lib/music-bank/bank-access";
import { privateBankAsPack } from "@/lib/music-bank/private-banks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/music-bank/private-banks — the PRIVATE music banks the signed-in person's business may use (owner 2026-11-10),
 * drawn like Genre Packs in the Royalty-Free catalog. A business without a grant gets an empty list — the banks' names and
 * songs never reach it. 2026-11-11 (owner): no exception for the platform owner either — he sees a bank in the catalog only
 * when it is switched on for the business he is in, exactly as that business's station can play it.
 */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const banks = await accessiblePrivateBanks({ workspaceId: user.tenantId ?? null });
  return NextResponse.json({ banks: banks.map(privateBankAsPack) }, { headers: { "Cache-Control": "no-store" } });
}
