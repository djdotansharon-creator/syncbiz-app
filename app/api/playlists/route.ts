import { NextRequest, NextResponse } from "next/server";
import { findOrCreateCatalogItem, normalizeCatalogUrlKey } from "@/lib/catalog-store";
import { listPlaylistsForTenant, createPlaylist } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import {
  PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT,
  type PlaylistCreateInput,
  type PlaylistTrack,
  type PlaylistType,
} from "@/lib/playlist-types";

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

    const bodyTracks = (body as { tracks?: unknown }).tracks;
    let tracks: PlaylistTrack[] | undefined =
      Array.isArray(bodyTracks) && bodyTracks.length > 0 ? (bodyTracks as PlaylistTrack[]) : undefined;

    const saveOrigin = (body as { saveOrigin?: unknown }).saveOrigin;
    if ("saveOrigin" in body && saveOrigin !== undefined) {
      if (saveOrigin !== PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT) {
        return NextResponse.json(
          {
            error: `saveOrigin must be omitted or "${PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT}"`,
          },
          { status: 400 },
        );
      }
    }
    const libraryPlacement: "ready_external" | undefined =
      saveOrigin === PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT ? "ready_external" : undefined;

    let catalogItemId: string | undefined;
    const tenantId = (user.tenantId ?? "").trim();
    if (tenantId) {
      try {
        const urlKey = normalizeCatalogUrlKey(url, type);
        if (urlKey) {
          const row = await findOrCreateCatalogItem({
            tenantId,
            urlKey,
            type,
            title: name,
            thumbnailUrl: thumbnail,
          });
          catalogItemId = row.id;
        }
      } catch (e) {
        console.warn("[api/playlists] POST catalog find-or-create skipped:", e);
      }
    }

    if (
      tenantId &&
      saveOrigin === PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT &&
      tracks &&
      tracks.length > 0
    ) {
      const enriched: PlaylistTrack[] = [];
      for (const t of tracks) {
        if (!t || typeof t.url !== "string" || !VALID_TYPES.includes(t.type)) {
          enriched.push(t);
          continue;
        }
        const u = t.url.trim();
        if (!u) {
          enriched.push(t);
          continue;
        }
        try {
          const urlKey = normalizeCatalogUrlKey(u, t.type);
          if (!urlKey) {
            enriched.push(t);
            continue;
          }
          const title = (t.name ?? t.title ?? "").trim() || "Untitled";
          const thumb = (t.cover ?? "").trim();
          const row = await findOrCreateCatalogItem({
            tenantId,
            urlKey,
            type: t.type,
            title,
            thumbnailUrl: thumb,
          });
          enriched.push({ ...t, catalogItemId: row.id });
        } catch (trackErr) {
          console.warn(
            "[api/playlists] POST youtube mix import catalog track find-or-create skipped:",
            trackErr,
          );
          enriched.push(t);
        }
      }
      tracks = enriched;
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
      ...(catalogItemId ? { catalogItemId } : {}),
      ...(tracks ? { tracks } : {}),
      ...(libraryPlacement ? { libraryPlacement } : {}),
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
