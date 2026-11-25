import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies, getAssignedBranchIdsForUser, hasBranchAccess } from "@/lib/auth-helpers";
import { getAccessType } from "@/lib/user-store";
import { allowHit } from "@/lib/simple-rate-limit";
import { previewSend } from "@/lib/schedule-day-share-store";

const HOUR = 60 * 60 * 1000;

/**
 * DRY RUN of sending a day (owner 2026-11-25): "7 fit, 2 cannot be placed" with the reasons, and which branches would get it. Same checks as the send (an OWNER who may use the source branch), writes NOTHING.
 *   POST { fromBranchId, weekday, targetBranchIds: string[] | "all" }
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = (user.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as { fromBranchId?: unknown; weekday?: unknown; targetBranchIds?: unknown };
  const fromBranchId = typeof b.fromBranchId === "string" ? b.fromBranchId.trim() : "";
  const requested: string[] | "all" | null = b.targetBranchIds === "all" ? "all" : Array.isArray(b.targetBranchIds) && b.targetBranchIds.every((x) => typeof x === "string") ? (b.targetBranchIds as string[]) : null;
  if (!fromBranchId || typeof b.weekday !== "number" || !Number.isInteger(b.weekday) || b.weekday < 0 || b.weekday > 6) {
    return NextResponse.json({ error: "fromBranchId and weekday (0 = Sunday … 6 = Saturday) are required" }, { status: 400 });
  }
  if (requested === null || (requested !== "all" && requested.length === 0)) return NextResponse.json({ error: 'Send targetBranchIds (a list of branch ids, or "all")' }, { status: 400 });

  if ((await getAccessType(user.id, tenantId)) !== "OWNER") return NextResponse.json({ error: "Only an owner of the business can send a day of a schedule to other branches" }, { status: 403 });
  if (!(await hasBranchAccess(user.id, fromBranchId, tenantId))) return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
  if (!allowHit(`schedule-day-preview:${user.id}`, 60, HOUR)) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });

  try {
    const access = await getAssignedBranchIdsForUser(user.id, tenantId);
    const r = await previewSend({ workspaceId: tenantId, fromBranchId, weekday: b.weekday, requested, access });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) {
    console.error("[api/schedule-day-shares/preview] POST error:", e);
    return NextResponse.json({ error: "Failed to preview the day" }, { status: 500 });
  }
}
