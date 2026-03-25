import { NextRequest, NextResponse } from "next/server";
import { getPlaylist, updatePlaylist, deletePlaylist } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import type { PlaylistType, PlaylistTrack } from "@/lib/playlist-types";

const VALID_TYPES: PlaylistType[] = ["soundcloud", "youtube", "spotify", "winamp", "local", "stream-url"];

async function requirePlaylistAccess(playlist: { branchId?: string; tenantId?: string } | null) {
  const user = await getCurrentUserFromCookies();
  if (!user) return { ok: false as const, status: 401 } as const;
  if (!playlist) return { ok: false as const, status: 404 } as const;
  if (playlist.tenantId && playlist.tenantId !== user.tenantId) {
    return { ok: false as const, status: 404 } as const;
  }
  if (!playlist.tenantId && user.tenantId !== "tnt-default") {
    return { ok: false as const, status: 404 } as const;
  }
  const branchId = resolveMediaBranchId(playlist);
  if (!(await hasBranchAccess(user.id, branchId))) {
    return { ok: false as const, status: 403 } as const;
  }
  return { ok: true as const, user } as const;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const playlist = await getPlaylist(id);
    const access = await requirePlaylistAccess(playlist);
    if (!access.ok) {
      return NextResponse.json(
        access.status === 401 ? { error: "Unauthorized" } : access.status === 403 ? { error: "Forbidden: no access to this branch" } : { error: "Playlist not found" },
        { status: access.status },
      );
    }
    return NextResponse.json(playlist!);
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
  const access = await requirePlaylistAccess(existing);
  if (!access.ok) {
    return NextResponse.json(
      access.status === 401 ? { error: "Unauthorized" } : access.status === 403 ? { error: "Forbidden: no access to this branch" } : { error: "Playlist not found" },
      { status: access.status },
    );
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
    const uid = await getUserIdFromSession();
    if (uid && existing) {
      void notifyLibraryUpdated(uid, { branchId: resolveMediaBranchId(existing), entityType: "playlist", action: "updated" });
    }
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
    const existing = await getPlaylist(id);
    const access = await requirePlaylistAccess(existing);
    if (!access.ok) {
      return NextResponse.json(
        access.status === 401 ? { error: "Unauthorized" } : access.status === 403 ? { error: "Forbidden: no access to this branch" } : { error: "Playlist not found" },
        { status: access.status },
      );
    }
    const ok = await deletePlaylist(id);
    if (!ok) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    const uid = await getUserIdFromSession();
    if (uid && existing) {
      void notifyLibraryUpdated(uid, { branchId: resolveMediaBranchId(existing), entityType: "playlist", action: "deleted" });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/playlists] DELETE error:", e);
    return NextResponse.json({ error: "Failed to delete playlist" }, { status: 500 });
  }
}
