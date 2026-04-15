import { NextRequest, NextResponse } from "next/server";
import { findOrCreateCatalogItem, normalizeCatalogUrlKey } from "@/lib/catalog-store";
import { db } from "@/lib/store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { detectProvider, inferPlayerMode } from "@/lib/player-utils";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import type { PlaylistType } from "@/lib/playlist-types";
import type { Source } from "@/lib/types";

function resolveAccountScope(userTenantId: string): string {
  return userTenantId === "tnt-default" ? "acct-demo-001" : userTenantId;
}

function mediaTypeToPlaylistType(media: string): PlaylistType {
  if (media === "youtube") return "youtube";
  if (media === "soundcloud") return "soundcloud";
  if (media === "spotify") return "spotify";
  return "stream-url";
}

function catalogKeyForTarget(target: string, playlistType: PlaylistType): string {
  return normalizeCatalogUrlKey(target, playlistType);
}

function catalogKeyForExistingSource(s: Source): string | null {
  const t = (s.target ?? s.uriOrPath ?? "").trim();
  if (!t) return null;
  const provider = s.provider ?? detectProvider(t);
  const pt: PlaylistType =
    provider === "youtube"
      ? "youtube"
      : provider === "soundcloud"
        ? "soundcloud"
        : t.toLowerCase().includes("spotify")
          ? "spotify"
          : "stream-url";
  const key = normalizeCatalogUrlKey(t, pt);
  return key || null;
}

/**
 * POST: add a single URL as a DB source (main library) for manual "Add to Library" from playlist tracks.
 * Dedupes by normalized catalog URL key for the tenant's existing sources.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.tenantId?.trim()) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }

  const body = (await req.json()) as {
    url?: string;
    title?: string;
    cover?: string;
    branchId?: string;
    mediaType?: string;
  };

  const url = (body.url ?? "").trim();
  const title = (body.title ?? "").trim() || "Untitled";
  const cover = (body.cover ?? "").trim();
  const branchId = (body.branchId ?? "default").trim() || "default";
  const mediaType = (body.mediaType ?? "youtube").trim();

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  if (!(await hasBranchAccess(user.id, branchId))) {
    return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
  }

  const playlistType = mediaTypeToPlaylistType(mediaType);
  const urlKey = catalogKeyForTarget(url, playlistType);
  if (!urlKey) {
    return NextResponse.json({ error: "Could not normalize URL for catalog" }, { status: 400 });
  }

  const accountId = resolveAccountScope(user.tenantId);
  const existingAll = await db.getSources(accountId);
  const duplicate = existingAll.find((s) => {
    const k = catalogKeyForExistingSource(s);
    return k != null && k === urlKey;
  });

  if (duplicate) {
    return NextResponse.json({ source: duplicate, duplicate: true }, { status: 200 });
  }

  const provider = detectProvider(url);
  const playerMode = inferPlayerMode(provider);

  const tenantId = user.tenantId.trim();
  try {
    await findOrCreateCatalogItem({
      tenantId,
      urlKey,
      type: playlistType,
      title,
      thumbnailUrl: cover,
    });
  } catch (e) {
    console.warn("[api/sources/add-from-catalog-track] catalog find-or-create skipped:", e);
  }

  const source = await db.addSource({
    name: title,
    branchId,
    type: "web_url",
    target: url,
    artworkUrl: cover || undefined,
    provider,
    playerMode,
    isLive: false,
    tags: [],
    accountId,
  });

  const uid = await getUserIdFromSession();
  if (uid) void notifyLibraryUpdated(uid, { branchId, entityType: "source", action: "created" });

  return NextResponse.json({ source, duplicate: false }, { status: 201 });
}
