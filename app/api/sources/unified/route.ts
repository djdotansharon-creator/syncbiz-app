import { NextResponse, type NextRequest } from "next/server";
import { listPlaylistsForTenant } from "@/lib/playlist-store";
import { listRadioStationsForTenant } from "@/lib/radio-store";
import { radioToUnified } from "@/lib/radio-utils";
import { db } from "@/lib/store";
import { getCurrentUserFromApiRequest, getAssignedBranchIdsForUser } from "@/lib/auth-helpers";
import { getAccessType } from "@/lib/user-store";
import {
  canRequestApiScope,
  parseApiContentScope,
  playlistMatchesApiScope,
  type ApiContentScope,
} from "@/lib/content-scope-filters";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { type UnifiedSource, type SourceProviderType, unifiedLibraryIdForDbSourceId } from "@/lib/source-types";
import { unifiedFoundationHints } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import type { Source } from "@/lib/types";
import { getSourceArtworkUrl, detectProvider } from "@/lib/player-utils";
import {
  derivePlaylistUnifiedCoverArt,
  getYouTubeThumbnail,
  unifiedPlaylistSourceId,
} from "@/lib/playlist-utils";
import { inferGenre } from "@/lib/infer-genre";
import { enrichPlaylistsWithCatalogForUnified, enrichUnifiedSourcesByCatalogUrl } from "@/lib/unified-catalog-enrichment";

function resolveAccountScope(userTenantId: string): string {
  return userTenantId === "tnt-default" ? "acct-demo-001" : userTenantId;
}

function playlistToUnified(p: Playlist): UnifiedSource {
  const cover = derivePlaylistUnifiedCoverArt(p);
  const tracks = getPlaylistTracks(p);
  const sole = tracks.length === 1 ? tracks[0] : null;
  return {
    id: unifiedPlaylistSourceId(p.id),
    title: p.name,
    genre: p.genre || "Mixed",
    cover,
    type: p.type as SourceProviderType,
    url: p.url,
    origin: "playlist",
    playlist: p,
    viewCount: p.viewCount ?? sole?.viewCount,
    likeCount: p.likeCount ?? sole?.likeCount,
    publishedAt: p.publishedAt ?? sole?.publishedAt,
    curationRating: p.curationRating ?? sole?.curationRating,
    ...(sole && typeof sole.durationSeconds === "number" && sole.durationSeconds > 0
      ? { leafDurationSeconds: sole.durationSeconds }
      : {}),
    ...unifiedFoundationHints("playlist", p.type as SourceProviderType, p.url),
    ...(p.libraryPlacement === "ready_external"
      ? { contentNodeKind: "external_playlist" as const }
      : {}),
  };
}

function dbSourceToUnified(s: { id: string; name: string; target: string; artworkUrl?: string; uriOrPath?: string; type?: string }): UnifiedSource {
  const target = (s.target ?? s.uriOrPath ?? "").trim();
  const provider = detectProvider(target);
  let type: SourceProviderType = "stream-url";
  if (provider === "youtube") type = "youtube";
  else if (provider === "soundcloud") type = "soundcloud";
  else if (target.includes("spotify")) type = "spotify";
  else if (target.match(/\.(m3u8?|pls)(\?|$)/i)) type = "winamp";
  else if (target.startsWith("http")) type = "stream-url";
  else type = "local";

  const cover = getSourceArtworkUrl(s as import("@/lib/types").Source) || getYouTubeThumbnail(target) || null;

  return {
    id: unifiedLibraryIdForDbSourceId(s.id),
    title: s.name,
    genre: inferGenre(s.name),
    cover,
    type,
    url: target,
    origin: "source",
    source: s as import("@/lib/types").Source,
    ...unifiedFoundationHints("source", type, target),
  };
}

function getSourceCreatedAtMs(source: UnifiedSource): number {
  const createdAt =
    source.playlist?.createdAt ??
    source.radio?.createdAt ??
    ((source.source as { createdAt?: string } | undefined)?.createdAt ?? "") ??
    "";
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? t : 0;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromApiRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scope: ApiContentScope = parseApiContentScope(request.nextUrl.searchParams.get("scope"));
  try {
    const accessType = await getAccessType(user.id, user.tenantId);
    if (!canRequestApiScope(scope, accessType)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Sequential fetches to avoid exhausting the small connection pool on free-tier PostgreSQL.
    const playlists = await listPlaylistsForTenant(user.tenantId);
    const radioStations = await listRadioStationsForTenant(user.tenantId);
    const dbSources = await db.getSources(resolveAccountScope(user.tenantId));

    const filteredDbSources = dbSources.filter((s) => (s.type as string) !== "radio");

    // Fetch the user's allowed branches ONCE and filter synchronously.
    // Previously we called hasBranchAccess() per-item inside Promise.all, which
    // triggered 3–4 DB queries per item (user lookup + role check + branch assignment).
    // With 20+ playlists and 20+ sources, that created 80–120 concurrent DB queries on
    // a 2-connection pool → P2024 timeouts.  Now: 1 query total.
    const allowedBranchIds = await getAssignedBranchIdsForUser(user.id);
    const isUnrestrictedOwner = allowedBranchIds.includes("*");
    function canAccessBranch(branchId: string): boolean {
      if (isUnrestrictedOwner) return true;
      const normalized = (branchId ?? "").trim() || "default";
      return allowedBranchIds.includes(normalized);
    }

    const items: UnifiedSource[] = [];

    const scopedPlaylists = playlists.filter((p) => playlistMatchesApiScope(p, scope));
    const okPlaylists = scopedPlaylists.filter((p) => canAccessBranch(resolveMediaBranchId(p)));
    try {
      await enrichPlaylistsWithCatalogForUnified(okPlaylists);
    } catch (enrichErr) {
      console.warn("[api/sources/unified] catalog enrichment skipped:", enrichErr);
    }
    for (const p of okPlaylists) {
      items.push(playlistToUnified(p));
    }

    if (scope === "branch") {
      for (const r of radioStations) {
        if (canAccessBranch(resolveMediaBranchId(r))) items.push(radioToUnified(r));
      }

      for (const s of filteredDbSources) {
        const branchId = (s as Source).branchId ?? "default";
        if (canAccessBranch(branchId)) items.push(dbSourceToUnified(s));
      }
    }

    items.sort((a, b) => getSourceCreatedAtMs(b) - getSourceCreatedAtMs(a));
    try {
      await enrichUnifiedSourcesByCatalogUrl(items);
    } catch (enrichErr) {
      console.warn("[api/sources/unified] url enrichment skipped:", enrichErr);
    }
    return NextResponse.json(items);
  } catch (e) {
    console.error("[api/sources/unified] GET error:", e);
    return NextResponse.json({ error: "Failed to list sources" }, { status: 500 });
  }
}
