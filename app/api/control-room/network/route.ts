import { NextRequest, NextResponse } from "next/server";
import { requireBranchManager } from "@/lib/control-room-auth";
import { BranchInputError, getStationIdPrefix, setStationIdPrefix } from "@/lib/branch-management";

/** Control Room — the organization's network code (Station ID prefix, e.g. AROMA → AROMA-192). Owner only. */
export async function GET() {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ stationIdPrefix: await getStationIdPrefix(auth.workspaceId) });
}

export async function PUT(req: NextRequest) {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  let body: { stationIdPrefix?: unknown };
  try {
    body = (await req.json()) as { stationIdPrefix?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    return NextResponse.json({ stationIdPrefix: await setStationIdPrefix(auth.workspaceId, body.stationIdPrefix) });
  } catch (e) {
    if (e instanceof BranchInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[control-room/network] set prefix failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not save the network code." }, { status: 500 });
  }
}
