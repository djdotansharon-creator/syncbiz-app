import { NextRequest, NextResponse } from "next/server";
import { getRadioStation } from "@/lib/radio-store";
import { getCurrentUserFromCookies, hasBranchAccess } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { readIcyStreamTitle } from "@/lib/radio-icy";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 15_000;

// One lookup per station per 15 s, shared by every screen polling it (and in-flight lookups are shared too).
const g = globalThis as unknown as { __vonoRadioNowPlaying?: Map<string, { at: number; title: Promise<string | null> }> };
const cache = (g.__vonoRadioNowPlaying ??= new Map());

/**
 * GET — the song the station is broadcasting right now ("Artist - Title" from the stream's ICY metadata), or
 * `title: null` when the station does not send it. Same access rules as GET /api/radio/[id]. Display only.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const station = await getRadioStation(id);
  if (!station) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (station.tenantId ? station.tenantId !== user.tenantId : user.tenantId !== "tnt-default") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await hasBranchAccess(user.id, resolveMediaBranchId(station), user.tenantId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = Date.now();
  let entry = cache.get(id);
  if (!entry || now - entry.at > CACHE_TTL_MS) {
    entry = { at: now, title: readIcyStreamTitle(station.url) };
    cache.set(id, entry);
    if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  }
  return NextResponse.json({ title: await entry.title });
}
