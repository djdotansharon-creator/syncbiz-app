import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { verifyDesktopStationToken } from "@/lib/auth-ws-token";
import { prisma } from "@/lib/prisma";
import { offlineManifestForStation } from "@/lib/music-bank/offline-manifest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/music-bank/offline-manifest — what ONE COMPUTER may keep OFFLINE (encrypted on its disk) and until when
 * (Music Bank Phase 2, stage B; owner 2026-11-10/11). Ids, titles, sizes and content hashes only — no audio, no URLs.
 *  - A STATION's Electron MAIN calls it with `Authorization: Bearer <desktop_access>` (the signed, station-bound token MAIN
 *    already holds — the same check as /api/music-bank/authorize): the token must name the station + business AND the
 *    station must be a registered StationDevice of that business.
 *  - A signed-in person (cookie) may ask for one computer of their active business: ?deviceId=<durable station id>.
 *  2026-11-12 (owner): Offline is chosen per computer and per bank (StationOfflineBank) — the manifest is per station.
 */
async function stationFromBearer(req: NextRequest): Promise<{ workspaceId: string; durableDeviceId: string } | "invalid" | null> {
  const h = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+/i.test(h)) return null;
  const claims = verifyDesktopStationToken(h.replace(/^Bearer\s+/i, "").trim());
  if (!claims) return "invalid";
  const station = await prisma.stationDevice.findUnique({ where: { durableDeviceId: claims.stationDeviceId }, select: { workspaceId: true } });
  if (!station || station.workspaceId !== claims.workspaceId) return "invalid";
  return { workspaceId: claims.workspaceId, durableDeviceId: claims.stationDeviceId };
}

export async function GET(req: NextRequest) {
  const station = await stationFromBearer(req);
  if (station === "invalid") return NextResponse.json({ error: "Station not authorized." }, { status: 401 });
  let workspaceId: string | null = station?.workspaceId ?? null;
  let deviceId: string | null = station?.durableDeviceId ?? null;
  if (!workspaceId) {
    const user = await getCurrentUserFromCookies();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    workspaceId = user.tenantId ?? null;
    if (!workspaceId) return NextResponse.json({ error: "No business selected." }, { status: 400 });
    deviceId = req.nextUrl.searchParams.get("deviceId")?.trim() || null;
    if (!deviceId) return NextResponse.json({ error: "deviceId is required." }, { status: 400 });
    const own = await prisma.stationDevice.findUnique({ where: { durableDeviceId: deviceId }, select: { workspaceId: true } });
    if (!own || own.workspaceId !== workspaceId) return NextResponse.json({ error: "This computer is not registered to your business." }, { status: 404 });
  }
  if (!workspaceId || !deviceId) return NextResponse.json({ error: "No business selected." }, { status: 400 });
  const manifest = await offlineManifestForStation(workspaceId, deviceId);
  if (!manifest) return NextResponse.json({ error: "Offline manifest unavailable." }, { status: 503 });
  return NextResponse.json(manifest, { headers: { "Cache-Control": "no-store" } });
}
