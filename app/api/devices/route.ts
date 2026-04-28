import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { EntitlementLimitError } from "@/lib/entitlement-limits";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import type { Device } from "@/lib/types";

export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = user.tenantId === "tnt-default" ? "acct-demo-001" : user.tenantId;
  return NextResponse.json(await db.getDevices(accountId));
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = (await req.json()) as Partial<Device>;

  if (!data.name || !data.branchId || !data.type || !data.status || !data.ipAddress) {
    return NextResponse.json(
      {
        error:
          "name, branchId, type, status, and ipAddress are required for creating a device",
      },
      { status: 400 },
    );
  }

  try {
    const device = await db.addDevice({
      name: data.name,
      branchId: data.branchId,
      type: data.type,
      status: data.status,
      ipAddress: data.ipAddress,
      agentVersion: data.agentVersion ?? "1.0.0",
      currentSourceId: data.currentSourceId,
      volume: data.volume ?? 50,
      platform: data.platform ?? "windows",
      health: data.health ?? "ok",
      capabilities:
        data.capabilities ?? ["supportsPlay", "supportsStop", "supportsVolume", "supportsResume"],
      accountId: user.tenantId === "tnt-default" ? "acct-demo-001" : user.tenantId,
    });

    return NextResponse.json(device, { status: 201 });
  } catch (e) {
    if (e instanceof EntitlementLimitError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    const msg = e instanceof Error ? e.message : "Failed to create device";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

