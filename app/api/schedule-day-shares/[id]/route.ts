import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserFromCookies, hasBranchAccess } from "@/lib/auth-helpers";
import { extractClientIp } from "@/lib/admin/tenant-audit";
import { allowHit } from "@/lib/simple-rate-limit";
import { isYmd } from "@/lib/schedule-skip";
import type { ApplyInput, DayShareAction } from "@/lib/schedule-day-share-rules";
import { answerOffer, getOfferInWorkspace } from "@/lib/schedule-day-share-store";

const HOUR = 60 * 60 * 1000;
const ACTIONS: DayShareAction[] = ["accept", "decline", "revoke", "undo", "preview"];

/**
 * Answer an offer of a day of a schedule (owner 2026-11-25). POST { action: "accept" | "decline" | "revoke" | "undo" | "preview", mode?: "weekday" | "date", weekdays?: number[], date?: "YYYY-MM-DD", conflict?: "replace" | "alongside" }
 *   · accept  — copies the day onto the receiving branch: `mode: "weekday"` = a weekly routine on `weekdays` (default: the day that was sent), `mode: "date"` = one calendar date (not in the past; today is allowed with a warning).
 *               "replace" (default) switches off the branch's own blocks of that day (never deletes); "alongside" changes nothing and only flags same-minute ties. Done in ONE transaction, once.
 *   · preview — what accept WOULD do (what is placed, what is skipped and why, what is replaced) — writes nothing;
 *   · decline — the receiving branch says no;  revoke — only the SENDER, only while pending;  undo — within 14 days of accepting: removes the copied blocks that were not edited since, puts back what was replaced.
 * WHO: accept / decline / preview / undo need access to the RECEIVING branch (which must be in the caller's business); an offer of another business is a 404.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = (user.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as { action?: unknown; mode?: unknown; weekdays?: unknown; date?: unknown; conflict?: unknown };
  const action = b.action as DayShareAction;
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  let apply: ApplyInput | undefined;
  if (action === "accept" || action === "preview") {
    if (b.mode !== "weekday" && b.mode !== "date") return NextResponse.json({ error: 'mode must be "weekday" or "date"' }, { status: 400 });
    if (b.conflict !== undefined && b.conflict !== "replace" && b.conflict !== "alongside") return NextResponse.json({ error: 'conflict must be "replace" or "alongside"' }, { status: 400 });
    if (b.mode === "date" && !isYmd(b.date)) return NextResponse.json({ error: "date must be a calendar date (YYYY-MM-DD)" }, { status: 400 });
    if (b.weekdays !== undefined && !(Array.isArray(b.weekdays) && b.weekdays.length <= 7 && b.weekdays.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6))) {
      return NextResponse.json({ error: "weekdays must be a list of numbers from 0 (Sunday) to 6 (Saturday)" }, { status: 400 });
    }
    apply = { mode: b.mode, ...(b.mode === "date" ? { date: b.date as string } : b.weekdays !== undefined ? { weekdays: b.weekdays as number[] } : {}), ...(b.conflict ? { conflict: b.conflict as "replace" | "alongside" } : {}) };
  }

  if (!allowHit(`schedule-day-${action === "preview" ? "preview" : "answer"}:${user.id}`, action === "preview" ? 120 : 60, HOUR)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  try {
    // the offer is found only inside the caller's business — an id from anywhere else is a 404
    const offer = await getOfferInWorkspace(tenantId, id);
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    const canUseTarget = await hasBranchAccess(user.id, offer.targetBranchId, tenantId);
    const r = await answerOffer({ workspaceId: tenantId, userId: user.id, offerId: id, action, canUseTarget, apply, ip: extractClientIp(req) });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    if (action === "accept" || action === "undo") revalidatePath("/schedules");
    return NextResponse.json(r);
  } catch (e) {
    console.error("[api/schedule-day-shares] POST error:", e);
    return NextResponse.json({ error: "Failed to answer the offer" }, { status: 500 });
  }
}
