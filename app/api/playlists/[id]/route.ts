import { NextRequest, NextResponse } from "next/server";
import { getPlaylist, updatePlaylist, deletePlaylist, isPlaylistPersistError } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, getUserIdFromSession } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { gatePlaylistAccess } from "@/lib/playlist-access";
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
  type Playlist,
} from "@/lib/playlist-types";
import { getCurrentPlatformUser } from "@/lib/auth/guards";
import {
  parsePublicationScope,
  publicationScopeRequiresPlatformAdmin,
} from "@/lib/playlist-publication-scope";

const VALID_TYPES: PlaylistType[] = ["soundcloud", "youtube", "spotify", "winamp", "local", "stream-url"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUserFromCookies();
    const playlist = await getPlaylist(id);
    const g = await gatePlaylistAccess(user ?? null, playlist);
    if (!g.allow) {
      return NextResponse.json({ error: g.message }, { status: g.httpStatus });
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
  const user = await getCurrentUserFromCookies();
  const existing = await getPlaylist(id);
  const g = await gatePlaylistAccess(user ?? null, existing);
  if (!g.allow) {
    return NextResponse.json({ error: g.message }, { status: g.httpStatus });
  }
  if (!existing) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown> & Partial<{
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
      publicationScope?: unknown;
    }>;
    if ("playlistOwnershipScope" in body) {
      return NextResponse.json(
        { error: "playlistOwnershipScope cannot be changed via PUT" },
        { status: 400 },
      );
    }
    const updates: Partial<Playlist> = {};

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

    if ("publicationScope" in body) {
      const parsed = parsePublicationScope(body.publicationScope);
      if (!parsed) {
        return NextResponse.json({ error: "publicationScope must be a valid PlaylistPublicationScope value" }, { status: 400 });
      }
      const platformUser = await getCurrentPlatformUser();
      const isPlatformSuperAdmin = platformUser?.role === "SUPER_ADMIN";

      if (publicationScopeRequiresPlatformAdmin(parsed) && !isPlatformSuperAdmin) {
        return NextResponse.json(
          {
            error:
              "Only SyncBiz platform admins may set Official SyncBiz or Template publication scope.",
          },
          { status: 403 },
        );
      }

      const currentScope = existing.publicationScope ?? "PRIVATE";
      if (publicationScopeRequiresPlatformAdmin(currentScope) && !isPlatformSuperAdmin && parsed !== currentScope) {
        return NextResponse.json(
          {
            error:
              "This playlist uses a platform-managed publication scope; only platform admins may change it.",
          },
          { status: 403 },
        );
      }

      updates.publicationScope = parsed;
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
    const user = await getCurrentUserFromCookies();
    const existing = await getPlaylist(id);
    const del = await gatePlaylistAccess(user ?? null, existing);
    if (!del.allow) {
      return NextResponse.json({ error: del.message }, { status: del.httpStatus });
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
