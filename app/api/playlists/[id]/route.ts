import { NextRequest, NextResponse } from "next/server";
import { getPlaylist, updatePlaylist, deletePlaylist, isPlaylistPersistError } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import {
  PLAYLIST_USE_CASES_PHASE1,
  PLAYLIST_PRIMARY_GENRES_PHASE15,
  PLAYLIST_SUB_GENRES_PHASE15,
  PLAYLIST_MOODS_PHASE15,
  PLAYLIST_ENERGY_LEVELS_PHASE15,
  type PlaylistType,
  type PlaylistTrack,
  type PlaylistUseCasePhase1,
  type PlaylistPrimaryGenrePhase15,
  type PlaylistSubGenrePhase15,
  type PlaylistMoodPhase15,
  type PlaylistEnergyLevelPhase15,
  type ScheduleContributorBlock,
} from "@/lib/playlist-types";

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
      scheduleContributorBlocks?: ScheduleContributorBlock[] | null;
      adminNotes?: string;
      useCase?: string | null;
      useCases?: unknown;
      primaryGenre?: string | null;
      subGenres?: unknown;
      mood?: string | null;
      energyLevel?: string | null;
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
    if ("scheduleContributorBlocks" in body) {
      const raw = body.scheduleContributorBlocks;
      if (raw === null || raw === undefined) {
        updates.scheduleContributorBlocks = undefined;
      } else if (!Array.isArray(raw)) {
        return NextResponse.json({ error: "scheduleContributorBlocks must be an array or null" }, { status: 400 });
      } else {
        updates.scheduleContributorBlocks = raw as ScheduleContributorBlock[];
      }
    }

    if (body.adminNotes !== undefined) {
      updates.adminNotes = String(body.adminNotes ?? "");
    }
    if ("useCase" in body) {
      const raw = body.useCase == null ? "" : String(body.useCase).trim();
      if (raw === "") {
        updates.useCase = undefined;
      } else if (!(PLAYLIST_USE_CASES_PHASE1 as readonly string[]).includes(raw)) {
        return NextResponse.json(
          {
            error: `useCase must be one of: ${PLAYLIST_USE_CASES_PHASE1.join(", ")} or empty`,
          },
          { status: 400 },
        );
      } else {
        updates.useCase = raw as PlaylistUseCasePhase1;
      }
    }

    if ("useCases" in body) {
      const raw = body.useCases;
      if (!Array.isArray(raw)) {
        return NextResponse.json({ error: "useCases must be an array" }, { status: 400 });
      }
      const seen = new Set<string>();
      const out: PlaylistUseCasePhase1[] = [];
      for (const item of raw) {
        const s = String(item).trim();
        if (!s) continue;
        if (!(PLAYLIST_USE_CASES_PHASE1 as readonly string[]).includes(s)) {
          return NextResponse.json(
            {
              error: `Each useCases entry must be one of: ${PLAYLIST_USE_CASES_PHASE1.join(", ")}`,
            },
            { status: 400 },
          );
        }
        if (!seen.has(s)) {
          seen.add(s);
          out.push(s as PlaylistUseCasePhase1);
        }
      }
      updates.useCases = out;
      if (!("useCase" in body)) {
        updates.useCase = out.length > 0 ? out[0] : undefined;
      }
    }

    if ("primaryGenre" in body) {
      const raw = body.primaryGenre == null ? "" : String(body.primaryGenre).trim();
      if (raw === "") {
        updates.primaryGenre = undefined;
      } else if (!(PLAYLIST_PRIMARY_GENRES_PHASE15 as readonly string[]).includes(raw)) {
        return NextResponse.json(
          {
            error: `primaryGenre must be one of: ${PLAYLIST_PRIMARY_GENRES_PHASE15.join(", ")} or empty`,
          },
          { status: 400 },
        );
      } else {
        updates.primaryGenre = raw as PlaylistPrimaryGenrePhase15;
      }
    }

    if ("subGenres" in body) {
      const raw = body.subGenres;
      if (!Array.isArray(raw)) {
        return NextResponse.json({ error: "subGenres must be an array" }, { status: 400 });
      }
      const seen = new Set<string>();
      const out: PlaylistSubGenrePhase15[] = [];
      for (const item of raw) {
        const s = String(item).trim();
        if (!s) continue;
        if (!(PLAYLIST_SUB_GENRES_PHASE15 as readonly string[]).includes(s)) {
          return NextResponse.json(
            {
              error: `Each subGenres entry must be one of: ${PLAYLIST_SUB_GENRES_PHASE15.join(", ")}`,
            },
            { status: 400 },
          );
        }
        if (!seen.has(s)) {
          seen.add(s);
          out.push(s as PlaylistSubGenrePhase15);
        }
      }
      updates.subGenres = out;
    }

    if ("mood" in body) {
      const raw = body.mood == null ? "" : String(body.mood).trim();
      if (raw === "") {
        updates.mood = undefined;
      } else if (!(PLAYLIST_MOODS_PHASE15 as readonly string[]).includes(raw)) {
        return NextResponse.json(
          { error: `mood must be one of: ${PLAYLIST_MOODS_PHASE15.join(", ")} or empty` },
          { status: 400 },
        );
      } else {
        updates.mood = raw as PlaylistMoodPhase15;
      }
    }

    if ("energyLevel" in body) {
      const raw = body.energyLevel == null ? "" : String(body.energyLevel).trim();
      if (raw === "") {
        updates.energyLevel = undefined;
      } else if (!(PLAYLIST_ENERGY_LEVELS_PHASE15 as readonly string[]).includes(raw)) {
        return NextResponse.json(
          {
            error: `energyLevel must be one of: ${PLAYLIST_ENERGY_LEVELS_PHASE15.join(", ")} or empty`,
          },
          { status: 400 },
        );
      } else {
        updates.energyLevel = raw as PlaylistEnergyLevelPhase15;
      }
    }

    const updated = await updatePlaylist(id, updates);
    const uid = await getUserIdFromSession();
    if (uid && existing) {
      void notifyLibraryUpdated(uid, { branchId: resolveMediaBranchId(existing), entityType: "playlist", action: "updated" });
    }
    return NextResponse.json(updated);
  } catch (e) {
    if (isPlaylistPersistError(e)) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
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
