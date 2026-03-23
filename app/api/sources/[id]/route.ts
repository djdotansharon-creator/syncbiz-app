import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/store";
import { addDeletedSourceId } from "@/lib/deleted-sources-store";
import { parseSessionValue } from "@/lib/auth-session";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import type { Source } from "@/lib/types";

const COOKIE_NAME = "syncbiz-session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const source = db.getSources().find((s) => s.id === id);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    return NextResponse.json(source);
  } catch (e) {
    console.error("[api/sources] GET error:", e);
    return NextResponse.json({ error: "Failed to load source" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = (await req.json()) as Partial<{ name: string; target: string; type: string; description?: string; artworkUrl?: string; browserPreference?: string }>;
    const source = db.getSources().find((s) => s.id === id);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    const updated = db.updateSource(id, {
      ...(data.name != null && { name: data.name }),
      ...(data.target != null && { target: data.target, uriOrPath: data.target }),
      ...(data.type != null && { type: data.type as Source["type"] }),
      ...(data.description != null && { description: data.description }),
      ...(data.artworkUrl != null && { artworkUrl: data.artworkUrl }),
      ...(data.browserPreference != null && { browserPreference: data.browserPreference as Source["browserPreference"] }),
    });
    const cookie = (await cookies()).get(COOKIE_NAME)?.value;
    const userId = cookie ? parseSessionValue(cookie) : null;
    if (userId) void notifyLibraryUpdated(userId, { entityType: "source", action: "updated" });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("[api/sources] PATCH error:", e);
    return NextResponse.json({ error: "Failed to update source" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const exists = db.getSources().some((s) => s.id === id);
    if (!exists) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    await addDeletedSourceId(id);
    db.deleteSource(id);
    const cookie = (await cookies()).get(COOKIE_NAME)?.value;
    const userId = cookie ? parseSessionValue(cookie) : null;
    if (userId) void notifyLibraryUpdated(userId, { entityType: "source", action: "deleted" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/sources] DELETE error:", e);
    return NextResponse.json({ error: "Failed to delete source" }, { status: 500 });
  }
}
