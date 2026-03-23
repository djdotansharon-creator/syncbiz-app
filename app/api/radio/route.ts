import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listRadioStations, createRadioStation } from "@/lib/radio-store";
import { parseSessionValue } from "@/lib/auth-session";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";

const COOKIE_NAME = "syncbiz-session";

export async function GET() {
  try {
    const stations = await listRadioStations();
    return NextResponse.json(stations);
  } catch (e) {
    console.error("[api/radio] GET", e);
    return NextResponse.json({ error: "Failed to list radio stations" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; url?: string; genre?: string; cover?: string | null };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!name || !url) {
      return NextResponse.json({ error: "name and url are required" }, { status: 400 });
    }
    const station = await createRadioStation({
      name,
      url,
      genre: typeof body.genre === "string" ? body.genre.trim() : "Radio",
      cover: body.cover ?? null,
    });
    const cookie = (await cookies()).get(COOKIE_NAME)?.value;
    const userId = cookie ? parseSessionValue(cookie) : null;
    if (userId) void notifyLibraryUpdated(userId, { entityType: "radio", action: "created" });
    return NextResponse.json(station);
  } catch (e) {
    console.error("[api/radio] POST", e);
    return NextResponse.json({ error: "Failed to create radio station" }, { status: 500 });
  }
}
