import { NextRequest, NextResponse } from "next/server";
import { requireEnrollmentCaller, clientIp } from "@/lib/device-enrollment-auth";
import { EnrollmentError, disableEnrollment, enableEnrollment, getAllocation, getEnrollmentConfig, setEnrollmentTtl, setMaxPlayers } from "@/lib/device-enrollment-store";
import { isEnrollmentEnvEnabled } from "@/lib/device-enrollment";

/**
 * Control Room — enrollment settings of THIS workspace (docs/DEVICE_ENROLLMENT_DESIGN.md §3). Admin only.
 *  GET  → { available (the server's env flag), enabled, ttlDays, allocation }
 *  POST { enabled?, ttlDays?, ownDeviceId?, ownDeviceLabel?, ownDeviceRole?, maxPlayers? }
 *    enabled:true  → switches it on and approves what already runs (every existing station + the admin's own device) so nothing goes dark
 *    maxPlayers    → the paid Player allocation — platform SUPER_ADMIN only
 */
export async function GET() {
  const auth = await requireEnrollmentCaller({ decide: true });
  if (!auth.ok) return auth.response;
  if (!auth.caller.actor.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const cfg = await getEnrollmentConfig(auth.caller.workspaceId);
  const allocation = cfg.enabled ? await getAllocation(auth.caller.workspaceId, cfg) : null;
  return NextResponse.json({ available: isEnrollmentEnvEnabled(), enabled: cfg.enabled, ttlDays: cfg.ttlDays, allocation }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireEnrollmentCaller({ decide: true });
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  if (!caller.actor.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: { enabled?: unknown; ttlDays?: unknown; ownDeviceId?: unknown; ownDeviceLabel?: unknown; ownDeviceRole?: unknown; maxPlayers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const ip = clientIp(req);
  try {
    if (typeof body.maxPlayers === "number") {
      if (!caller.isPlatformSuperAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await setMaxPlayers({ workspaceId: caller.workspaceId, actorUserId: caller.user.id, maxPlayers: body.maxPlayers, ip });
    }
    if (body.enabled === true) {
      const own = typeof body.ownDeviceId === "string" ? body.ownDeviceId.trim() : "";
      await enableEnrollment({
        workspaceId: caller.workspaceId,
        actorUserId: caller.user.id,
        ttlDays: typeof body.ttlDays === "number" ? body.ttlDays : undefined,
        ownDeviceId: own.length >= 8 && own.length <= 128 ? own : null,
        ownDeviceLabel: typeof body.ownDeviceLabel === "string" ? body.ownDeviceLabel : undefined,
        ownDeviceRole: body.ownDeviceRole === "PLAYER" ? "PLAYER" : "REMOTE",
        ip,
      });
    } else if (body.enabled === false) {
      await disableEnrollment({ workspaceId: caller.workspaceId, actorUserId: caller.user.id, ip });
    } else if (typeof body.ttlDays === "number") {
      await setEnrollmentTtl({ workspaceId: caller.workspaceId, actorUserId: caller.user.id, ttlDays: body.ttlDays, ip });
    }
  } catch (e) {
    if (e instanceof EnrollmentError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[device-enrollment] settings failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "settings_failed" }, { status: 500 });
  }
  const cfg = await getEnrollmentConfig(caller.workspaceId);
  return NextResponse.json({ available: isEnrollmentEnvEnabled(), enabled: cfg.enabled, ttlDays: cfg.ttlDays, allocation: cfg.enabled ? await getAllocation(caller.workspaceId, cfg) : null });
}
