import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { listSharesForPerson } from "@/lib/playlist-share-store";
import type { ShareStatus } from "@/lib/playlist-share-rules";

/**
 * The shares sent TO ME as a person, from any business (owner 2026-11-23, sharing phase D). ?status=pending (default) | accepted | all.
 * Only the caller's own shares; the playlists in them are the whitelisted read-only view (lib/playlist-share-redact.ts) — never the sender's raw data.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const s = (req.nextUrl.searchParams.get("status") ?? "pending").toLowerCase();
  const statuses: ShareStatus[] = s === "accepted" ? ["ACCEPTED"] : s === "all" ? ["PENDING", "ACCEPTED"] : ["PENDING"];
  try {
    return NextResponse.json(await listSharesForPerson({ userId: user.id, statuses }));
  } catch (e) {
    console.error("[api/playlist-shares/mine] error:", e);
    return NextResponse.json({ error: "Failed to list shares" }, { status: 500 });
  }
}
