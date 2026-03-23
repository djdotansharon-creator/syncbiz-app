import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPlaylist, updatePlaylist, deletePlaylist } from "@/lib/playlist-store";
import { parseSessionValue } from "@/lib/auth-session";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import type { PlaylistType, PlaylistTrack } from "@/lib/playlist-types";

const COOKIE_NAME = "syncbiz-session";

const VALID_TYPES: PlaylistType[] = ["soundcloud", "youtube", "spotify", "winamp", "local", "stream-url"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const playlist = await getPlaylist(id);
    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    return NextResponse.json(playlist);
  } catch (e) {
    console.error("[api/playlists] GET error:", e);
    return NextResponse.json({ error: "Failed to load playlist" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await getPlaylist(id);
  if (!existing) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  try {
    const body = (await req.json()) as Partial<{
      name: string;
      genre: string;
      type: PlaylistType;
      url: string;
      thumbnail: string;
      tracks?: PlaylistTrack[];
      order?: string[];
    }>;
    const updates: Partial<typeof existing> = {};

    if (body.name != null) updates.name = String(body.name).trim();
    if (body.genre != null) updates.genre = String(body.genre).trim();
    if (body.type != null) {
      if (!VALID_TYPES.includes(body.type)) {
        return NextResponse.json(
          { error: `type must be one of: ${VALID_TYPES.join(", ")}` },
          { status: 400 },
        );
      }
      updates.type = body.type;
    }
    if (body.url != null) updates.url = String(body.url).trim();
    if (body.thumbnail != null) updates.thumbnail = String(body.thumbnail).trim();
    if (body.tracks != null) updates.tracks = body.tracks;
    if (body.order != null) updates.order = body.order;

    const updated = await updatePlaylist(id, updates);
    return NextResponse.json(updated);
  } catch (e) {
    console.error("[api/playlists] PUT error:", e);
    return NextResponse.json(
      { error: "Failed to update playlist" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ok = await deletePlaylist(id);
    if (!ok) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    const cookie = (await cookies()).get(COOKIE_NAME)?.value;
    const userId = cookie ? parseSessionValue(cookie) : null;
    if (userId) void notifyLibraryUpdated(userId, { entityType: "playlist", action: "deleted" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/playlists] DELETE error:", e);
    return NextResponse.json({ error: "Failed to delete playlist" }, { status: 500 });
  }
}
