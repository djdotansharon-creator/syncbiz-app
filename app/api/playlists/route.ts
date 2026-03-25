import { NextRequest, NextResponse } from "next/server";
import { listPlaylistsForTenant, createPlaylist } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import type { PlaylistCreateInput, PlaylistType } from "@/lib/playlist-types";

const VALID_TYPES: PlaylistType[] = ["soundcloud", "youtube", "spotify", "winamp", "local", "stream-url"];
const DEFAULT_BRANCH_ID = "default";

export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.tenantId?.trim()) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }
  try {
    const all = await listPlaylistsForTenant(user.tenantId);
    const filtered = [];
    for (const p of all) {
      const branchId = resolveMediaBranchId(p);
      if (await hasBranchAccess(user.id, branchId)) {
        filtered.push(p);
      }
    }
    return NextResponse.json(filtered);
  } catch (e) {
    console.error("[api/playlists] GET error:", e);
    return NextResponse.json(
      { error: "Failed to list playlists" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as Partial<PlaylistCreateInput>;
    const name = (body.name ?? "").trim();
    const url = (body.url ?? "").trim();
    const type = body.type ?? "stream-url";
    const genre = (body.genre ?? "").trim();
    const thumbnail = ((body.cover ?? body.thumbnail) ?? "").trim();
    const branchId = (body.branchId ?? DEFAULT_BRANCH_ID).trim() || DEFAULT_BRANCH_ID;
    const viewCount = typeof body.viewCount === "number" && body.viewCount >= 0 ? body.viewCount : undefined;
    const durationSeconds = typeof body.durationSeconds === "number" && body.durationSeconds >= 0 ? body.durationSeconds : undefined;

    if (!name || !url) {
      return NextResponse.json(
        { error: "name and url are required" },
        { status: 400 },
      );
    }

    if (!(await hasBranchAccess(user.id, branchId))) {
      return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
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
      branchId,
      tenantId: user.tenantId,
      viewCount,
      durationSeconds,
    });
    const uid = await getUserIdFromSession();
    if (uid) void notifyLibraryUpdated(uid, { branchId, entityType: "playlist", action: "created" });
    return NextResponse.json(playlist, { status: 201 });
  } catch (e) {
    console.error("[api/playlists] POST error:", e);
    return NextResponse.json(
      { error: "Failed to create playlist" },
      { status: 500 },
    );
  }
}
