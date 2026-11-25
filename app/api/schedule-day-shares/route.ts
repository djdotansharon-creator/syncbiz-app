import { NextRequest, NextResponse } from "next/server";
import { shadowAuthorize } from "@/lib/authz";
import { getCurrentUserFromCookies, getAssignedBranchIdsForUser, hasBranchAccess } from "@/lib/auth-helpers";
import { getAccessType } from "@/lib/user-store";
import { extractClientIp } from "@/lib/admin/tenant-audit";
import { allowHit } from "@/lib/simple-rate-limit";
import { DAY_SHARE_LIMITS, type DayShareStatus } from "@/lib/schedule-day-share-rules";
import { listOffers, sendOffers } from "@/lib/schedule-day-share-store";
import { workspaceBranchIds } from "@/lib/playlist-share-store";

const HOUR = 60 * 60 * 1000;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,100}$/;

/**
 * Send ONE DAY of a branch's schedule to other branches of the SAME business (owner 2026-11-25, phase 1: the server). Each receiving branch gets an OFFER and decides; nothing changes in its schedule before it accepts.
 *   POST { fromBranchId, weekday (0 = Sunday … 6), targetBranchIds: string[] | "all", requestId } → one PENDING offer per branch. Only an OWNER who may use the source branch; targets only inside the caller's business
 *        and only branches the caller may use; `requestId` makes a retry / double click send once. Replies what was made, what was skipped (and why) and how many fit.
 *   GET  ?status=pending (default) | accepted | all | history   &branchId=<id> (one branch the caller may use)   &sent=1 (the offers the caller sent) → offers. Always inside the caller's business.
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
  const b = (body ?? {}) as { fromBranchId?: unknown; weekday?: unknown; targetBranchIds?: unknown; requestId?: unknown };
  const fromBranchId = typeof b.fromBranchId === "string" ? b.fromBranchId.trim() : "";
  const requested: string[] | "all" | null = b.targetBranchIds === "all" ? "all" : Array.isArray(b.targetBranchIds) && b.targetBranchIds.every((x) => typeof x === "string") ? (b.targetBranchIds as string[]) : null;
  if (!fromBranchId || typeof b.weekday !== "number" || !Number.isInteger(b.weekday) || b.weekday < 0 || b.weekday > 6) {
    return NextResponse.json({ error: "fromBranchId and weekday (0 = Sunday … 6 = Saturday) are required" }, { status: 400 });
  }
  if (requested === null || (requested !== "all" && requested.length === 0)) return NextResponse.json({ error: 'Send targetBranchIds (a list of branch ids, or "all")' }, { status: 400 });
  if (typeof b.requestId !== "string" || !REQUEST_ID.test(b.requestId)) return NextResponse.json({ error: "requestId is required (8–100 letters, digits, . _ : -)" }, { status: 400 });

  // only an OWNER of the business, and only from a branch they may use
  if ((await getAccessType(user.id, tenantId)) !== "OWNER") return NextResponse.json({ error: "Only an owner of the business can send a day of a schedule to other branches" }, { status: 403 });
  if (!(await hasBranchAccess(user.id, fromBranchId, tenantId))) return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
  if (!allowHit(`schedule-day-send:${user.id}`, DAY_SHARE_LIMITS.SENDS_PER_HOUR, HOUR)) return NextResponse.json({ error: "Too many sends in a short time. Try again later." }, { status: 429 });
  shadowAuthorize("schedule-day-shares:POST", { userId: user.id, workspaceId: tenantId }, "schedule.edit", [fromBranchId]); // Gate 3A shadow: log only, never blocks

  try {
    const access = await getAssignedBranchIdsForUser(user.id, tenantId);
    const r = await sendOffers({ workspaceId: tenantId, userId: user.id, fromBranchId, weekday: b.weekday, requested, access, requestId: b.requestId, ip: extractClientIp(req) });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    console.info(`[schedule-day-shares] sent a day (weekday ${b.weekday}) from ${fromBranchId}: ${r.created.length} offer(s) made, ${r.alreadySent.length} already sent, ${r.skippedTargets.length} branch(es) skipped`);
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    console.error("[api/schedule-day-shares] POST error:", e);
    return NextResponse.json({ error: "Failed to send the day" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = (user.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });

  const s = (req.nextUrl.searchParams.get("status") ?? "pending").toLowerCase();
  const statuses: DayShareStatus[] = s === "accepted" ? ["ACCEPTED"] : s === "all" ? ["PENDING", "ACCEPTED"] : s === "history" ? ["DECLINED", "REVOKED", "UNDONE"] : ["PENDING"];
  const one = (req.nextUrl.searchParams.get("branchId") ?? "").trim();
  const sent = req.nextUrl.searchParams.get("sent") === "1";
  try {
    const [access, wsBranches] = await Promise.all([getAssignedBranchIdsForUser(user.id, tenantId), workspaceBranchIds(tenantId)]);
    const allAccess = access.includes("*");
    let branchIds: string[] | "*";
    if (one) {
      if (!wsBranches.includes(one)) return NextResponse.json({ error: "Unknown branch" }, { status: 404 });
      if (!allAccess && !access.includes(one)) return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
      branchIds = [one];
    } else {
      branchIds = allAccess ? "*" : access.filter((x) => wsBranches.includes(x));
    }
    return NextResponse.json(await listOffers({ workspaceId: tenantId, branchIds, statuses, ...(sent ? { sentBy: user.id } : {}) }));
  } catch (e) {
    console.error("[api/schedule-day-shares] GET error:", e);
    return NextResponse.json({ error: "Failed to list the offers" }, { status: 500 });
  }
}
