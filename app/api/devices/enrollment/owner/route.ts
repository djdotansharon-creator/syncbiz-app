import { NextRequest, NextResponse } from "next/server";
import { requireEnrollmentCaller, clientIp } from "@/lib/device-enrollment-auth";
import { EnrollmentError, approveOwnDevice } from "@/lib/device-enrollment-store";
import { toPublicStatus } from "@/lib/device-enrollment";

/**
 * Device enrollment — "I'm the owner" (owner 2026-10-28). POST { durableDeviceId, platform?, label? }: the workspace's main admin approves THIS device himself (a control device for every branch; never a Player,
 * never counted in the paid allocation) — the one who approves everyone else does not wait for someone else to approve his new computer. Admin only (a manager or anyone else gets 403); recorded in the audit log as a self-approval.
 */
const DEVICE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export async function POST(req: NextRequest) {
  const auth = await requireEnrollmentCaller();
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  if (!caller.actor.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: { durableDeviceId?: unknown; platform?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const id = typeof body.durableDeviceId === "string" ? body.durableDeviceId.trim() : "";
  if (!DEVICE_ID.test(id)) return NextResponse.json({ error: "invalid_device_id" }, { status: 400 });
  const platform = body.platform === "ios" || body.platform === "android" ? body.platform : "browser";
  const label = (typeof body.label === "string" ? body.label.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "").slice(0, 60);
  try {
    const row = await approveOwnDevice({ workspaceId: caller.workspaceId, userId: caller.user.id, durableDeviceId: id, platform, label: label ? `Owner · ${label}` : "Owner", ip: clientIp(req) });
    return NextResponse.json(toPublicStatus(row, new Date()), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof EnrollmentError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[device-enrollment] owner approval failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "owner_failed" }, { status: 500 });
  }
}
