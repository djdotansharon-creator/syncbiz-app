import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { backfillCatalogGenres } from "@/lib/catalog-store";

export async function POST() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const updated = await backfillCatalogGenres();
  return NextResponse.json({ updated });
}
