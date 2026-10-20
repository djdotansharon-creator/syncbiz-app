import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

/**
 * Control Room — Google Maps browser configuration (read at runtime, so a key change needs no rebuild).
 * The BROWSER key is visible to the page by nature; it must be restricted in Google Cloud to this site (HTTP referrer)
 * and to Maps JavaScript API + Places API (New). The SERVER key (GOOGLE_MAPS_API_KEY) is never returned here.
 * No browser key → { browserKey: null } and the Control Room keeps its built-in map.
 */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const browserKey = (process.env.GOOGLE_MAPS_BROWSER_KEY ?? "").trim() || null;
  const mapId = (process.env.GOOGLE_MAPS_MAP_ID ?? "").trim() || null;
  return NextResponse.json({ browserKey, mapId }, { headers: { "Cache-Control": "no-store" } });
}
