import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRadioStation, updateRadioStation, deleteRadioStation } from "@/lib/radio-store";
import { parseSessionValue } from "@/lib/auth-session";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";

const COOKIE_NAME = "syncbiz-session";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const station = await getRadioStation(id);
    if (!station) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(station);
  } catch (e) {
    console.error("[api/radio] GET error:", e);
    return NextResponse.json({ error: "Failed to load station" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { name?: string; url?: string; genre?: string; cover?: string | null };
    const station = await updateRadioStation(id, {
      ...(typeof body.name === "string" && { name: body.name.trim() }),
      ...(typeof body.url === "string" && { url: body.url.trim() }),
      ...(typeof body.genre === "string" && { genre: body.genre.trim() }),
      ...(body.cover !== undefined && { cover: body.cover }),
    });
    if (!station) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const cookie = (await cookies()).get(COOKIE_NAME)?.value;
    const userId = cookie ? parseSessionValue(cookie) : null;
    if (userId) void notifyLibraryUpdated(userId, { entityType: "radio", action: "updated" });
    return NextResponse.json(station);
  } catch (e) {
    console.error("[api/radio] PUT error:", e);
    return NextResponse.json({ error: "Failed to update station" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ok = await deleteRadioStation(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const cookie = (await cookies()).get(COOKIE_NAME)?.value;
    const userId = cookie ? parseSessionValue(cookie) : null;
    if (userId) void notifyLibraryUpdated(userId, { entityType: "radio", action: "deleted" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/radio] DELETE error:", e);
    return NextResponse.json({ error: "Failed to delete station" }, { status: 500 });
  }
}
