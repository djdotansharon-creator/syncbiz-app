import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import type { Device } from "@/lib/types";

export async function GET() {
  return NextResponse.json(db.getDevices());
}

export async function POST(req: NextRequest) {
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

  const device = db.addDevice({
    name: data.name,
    branchId: data.branchId,
    type: data.type,
    status: data.status,
    ipAddress: data.ipAddress,
    agentVersion: data.agentVersion ?? "1.0.0",
    currentSourceId: data.currentSourceId,
    volume: data.volume ?? 50,
    platform: data.platform,
    health: data.health,
    capabilities: data.capabilities,
  });

  return NextResponse.json(device, { status: 201 });
}

