import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getOrAssignUserHandle } from "@/lib/user-handle-store";

/**
 * The signed-in person's own VONO ID ("name#1234"), assigned on first use (owner 2026-11-22). Answers ONLY about the caller — there is no lookup of other people here
 * (finding someone by their exact ID comes with sharing).
 */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const handle = await getOrAssignUserHandle(user.id);
    return NextResponse.json({ handle });
  } catch (e) {
    console.error("[api/me/vono-id] error:", e);
    return NextResponse.json({ error: "Failed to read the VONO ID" }, { status: 500 });
  }
}
