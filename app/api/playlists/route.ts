import { NextRequest, NextResponse } from "next/server";
import { listPlaylists, createPlaylist } from "@/lib/playlist-store";
import type { PlaylistCreateInput, PlaylistType } from "@/lib/playlist-types";

const VALID_TYPES: PlaylistType[] = ["soundcloud", "youtube", "spotify", "winamp", "local", "stream-url"];

export async function GET() {
  try {
    const playlists = await listPlaylists();
    return NextResponse.json(playlists);
  } catch (e) {
    console.error("[api/playlists] GET error:", e);
    return NextResponse.json(
      { error: "Failed to list playlists" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<PlaylistCreateInput>;
    const name = (body.name ?? "").trim();
    const url = (body.url ?? "").trim();
    const type = body.type ?? "stream-url";
    const genre = (body.genre ?? "").trim();
    const thumbnail = ((body.cover ?? body.thumbnail) ?? "").trim();

    if (!name || !url) {
      return NextResponse.json(
        { error: "name and url are required" },
        { status: 400 },
      );
    }

    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    const playlist = await createPlaylist({
      name,
      genre,
      type,
      url,
      thumbnail,
    });
    return NextResponse.json(playlist, { status: 201 });
  } catch (e) {
    console.error("[api/playlists] POST error:", e);
    return NextResponse.json(
      { error: "Failed to create playlist" },
      { status: 500 },
    );
  }
}
