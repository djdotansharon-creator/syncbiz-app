import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromApiRequest } from "@/lib/auth-helpers";

// Prisma write → Node runtime. Both browser and Electron players hit this
// (getCurrentUserFromApiRequest accepts the session cookie OR the desktop
// bearer ws-token), so incidents are captured wherever playback runs.
export const runtime = "nodejs";

const KINDS = new Set(["freeze", "self_heal_redispatch", "skip_recover", "recovered", "stall_error"]);

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/**
 * Record one playback-reliability incident. Auth-gated so it can't be spammed
 * anonymously. Best-effort: any failure returns 200 with { ok:false } and is
 * ignored by the fire-and-forget client — telemetry must never disturb a player.
 */
export async function POST(req: Request) {
  const user = await getCurrentUserFromApiRequest(req);
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let b: Record<string, unknown> | null = null;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const kind = str(b?.kind, 40);
  if (!kind || !KINDS.has(kind)) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    await prisma.playbackIncident.create({
      data: {
        kind,
        deviceId: str(b?.deviceId, 100),
        branchId: str(b?.branchId, 100),
        workspaceId: user.tenantId ?? str(b?.workspaceId, 100),
        userEmail: user.email ?? null,
        deviceMode: str(b?.deviceMode, 20),
        platform: str(b?.platform, 20),
        sourceType: str(b?.sourceType, 40),
        sourceTitle: str(b?.sourceTitle, 300),
        urlHost: str(b?.urlHost, 200),
        attempt: num(b?.attempt),
        frozenMs: num(b?.frozenMs),
        recovered: bool(b?.recovered),
        mpvStatus: str(b?.mpvStatus, 20),
        engineReady: bool(b?.engineReady),
        appVersion: str(b?.appVersion, 40),
        detail:
          b?.detail && typeof b.detail === "object" && !Array.isArray(b.detail)
            ? (b.detail as Prisma.InputJsonValue)
            : undefined,
      },
    });
  } catch {
    // The table may not be migrated yet, or the DB may be briefly unavailable.
    // Never surface this to the player.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
