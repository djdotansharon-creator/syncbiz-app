import { NextResponse, type NextRequest } from "next/server";
import { listPlaylistsForTenant } from "@/lib/playlist-store";
import { listRadioStationsForTenant } from "@/lib/radio-store";
import { radioToUnified } from "@/lib/radio-utils";
import { db } from "@/lib/store";
import { getDeletedSourceIds } from "@/lib/deleted-sources-store";
import { getCurrentUserFromApiRequest, hasBranchAccess } from "@/lib/auth-helpers";
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
import type { Source } from "@/lib/types";
import { getSourceArtworkUrl, detectProvider } from "@/lib/player-utils";
import { getYouTubeThumbnail, unifiedPlaylistSourceId } from "@/lib/playlist-utils";
import { inferGenre } from "@/lib/infer-genre";

function resolveAccountScope(userTenantId: string): string {
  return userTenantId === "tnt-default" ? "acct-demo-001" : userTenantId;
}

function playlistToUnified(p: Playlist): UnifiedSource {
  const cover = p.thumbnail || p.cover || null;
  return {
    id: unifiedPlaylistSourceId(p.id),
    title: p.name,
    genre: p.genre || "Mixed",
    cover,
    type: p.type as SourceProviderType,
    url: p.url,
    origin: "playlist",
    playlist: p,
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
    const accessType = await getAccessType(user.id);
    if (!canRequestApiScope(scope, accessType)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [playlists, radioStations, dbSources, deletedIds] = await Promise.all([
      listPlaylistsForTenant(user.tenantId),
      listRadioStationsForTenant(user.tenantId),
      Promise.resolve(db.getSources(resolveAccountScope(user.tenantId))),
      getDeletedSourceIds(),
    ]);

    const filteredDbSources = dbSources.filter((s) => !deletedIds.has(s.id));

    const items: UnifiedSource[] = [];

    for (const p of playlists) {
      if (!playlistMatchesApiScope(p, scope)) continue;
      const branchId = resolveMediaBranchId(p);
      if (await hasBranchAccess(user.id, branchId)) {
        items.push(playlistToUnified(p));
      }
    }
    if (scope === "branch") {
      for (const r of radioStations) {
        const branchId = resolveMediaBranchId(r);
        if (await hasBranchAccess(user.id, branchId)) {
          items.push(radioToUnified(r));
        }
      }
      for (const s of filteredDbSources) {
        const branchId = (s as Source).branchId ?? "default";
        if (await hasBranchAccess(user.id, branchId)) {
          items.push(dbSourceToUnified(s));
        }
      }
    }

    items.sort((a, b) => getSourceCreatedAtMs(b) - getSourceCreatedAtMs(a));
    return NextResponse.json(items);
  } catch (e) {
    console.error("[api/sources/unified] GET error:", e);
    return NextResponse.json({ error: "Failed to list sources" }, { status: 500 });
  }
}
