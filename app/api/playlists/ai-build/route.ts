import { NextResponse } from "next/server";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import type { Playlist } from "@/lib/playlist-types";
import { EntitlementLimitError } from "@/lib/entitlement-limits";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import {
  AiPlaylistNoStrongMatchesError,
  executeAiPlaylistBuild,
  parseAdditionalLocalCandidates,
  type AiPlaylistBuildMode,
} from "@/lib/recommendations/ai-playlist-generation";
import { resolvePlaylistForAiSeed } from "@/lib/playlist-ai-access";

const VALID_MODES = new Set<AiPlaylistBuildMode>(["prompt", "similar", "refine", "expand"]);

export async function POST(req: Request) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = (user.tenantId ?? "").trim();
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const modeRaw = typeof body.mode === "string" ? body.mode.trim() : "";
  if (!VALID_MODES.has(modeRaw as AiPlaylistBuildMode)) {
    return NextResponse.json({ error: "mode must be prompt | similar | refine | expand" }, { status: 400 });
  }
  const mode = modeRaw as AiPlaylistBuildMode;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const refinementPrompt = typeof body.refinementPrompt === "string" ? body.refinementPrompt.trim() : "";
  const seedPlaylistIdRaw = typeof body.seedPlaylistId === "string" ? body.seedPlaylistId.trim() : "";
  const branchIdRaw = typeof body.branchId === "string" ? body.branchId.trim() : "default";
  const branchId = branchIdRaw || "default";

  const count =
    typeof body.count === "number" && Number.isFinite(body.count) ? Math.round(body.count) : undefined;

  if (mode === "prompt" && prompt.length < 1) {
    return NextResponse.json({ error: "prompt is required for mode=prompt" }, { status: 400 });
  }
  if ((mode === "similar" || mode === "refine" || mode === "expand") && !seedPlaylistIdRaw) {
    return NextResponse.json({ error: "seedPlaylistId is required for this mode" }, { status: 400 });
  }
  if (mode === "refine" && refinementPrompt.length < 1) {
    return NextResponse.json({ error: "refinementPrompt is required for mode=refine" }, { status: 400 });
  }

  if (!(await hasBranchAccess(user.id, branchId))) {
    return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
  }

  let seedPlaylist: Playlist | null = null;

  if (seedPlaylistIdRaw) {
    const resolved = await resolvePlaylistForAiSeed(user, seedPlaylistIdRaw);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.message }, { status: resolved.status });
    }
    seedPlaylist = resolved.playlist;
    const pb = (resolved.playlist.branchId ?? "").trim() || "default";
    const scope = resolved.playlist.playlistOwnershipScope ?? "branch";
    if (playlistTenantScoped(resolved.playlist, tenantId) && scope !== "owner_personal") {
      if (!(await hasBranchAccess(user.id, pb))) {
        return NextResponse.json({ error: "Forbidden: seed playlist branch inaccessible" }, { status: 403 });
      }
    }
  }

  /**
   * Phase 1 hybrid: Desktop renderer attaches `additionalCandidates.localTracks` when the
   * local snapshot has matches for the prompt. We safely parse/validate here — unknown keys
   * are dropped, bad shapes ignored, and the rest of the build runs catalog-only.
   * Local candidates NEVER become CatalogItems (enforced downstream by type === "local").
   */
  const additionalLocalCandidates = parseAdditionalLocalCandidates(body.additionalCandidates);

  try {
    const result = await executeAiPlaylistBuild({
      tenantId,
      mode,
      prompt: mode === "prompt" ? prompt : prompt || refinementPrompt || "",
      refinementPrompt,
      seedPlaylist,
      branchId,
      count,
      additionalLocalCandidates,
    });

    const uid = await getUserIdFromSession();
    if (uid) {
      void notifyLibraryUpdated(uid, {
        branchId,
        entityType: "playlist",
        action: "created",
        entityId: result.playlistId,
      });
    }

    return NextResponse.json({
      kind: "syncbiz_ai_playlist_build_v1",
      playlistId: result.playlistId,
      title: result.name,
      count: result.trackCount,
      requestedCount: result.requestedCount,
      mode: result.mode,
      shortfallExplanation: result.shortfallExplanation,
      shortfallHint: result.shortfallHint,
      catalogCandidatesPooled: result.catalogCandidatesPooled,
      localCandidatesReceived: result.localCandidatesReceived,
      localTracksInPlaylist: result.localTracksInPlaylist,
      catalogTracksInPlaylist: result.catalogTracksInPlaylist,
      ...(result.recipeMode ? { recipeMode: result.recipeMode } : {}),
      ...(result.laneBuildDebug ? { laneBuildDebug: result.laneBuildDebug } : {}),
      ...(result.buildDiagnostics ? { buildDiagnostics: result.buildDiagnostics } : {}),
      // Per-track display chips (genre / mood / subGenres / metadataSource)
      // keyed by `PlaylistTrack.id`. Renderer caches this by `playlistId` for
      // the session so the chips travel through edit/track list/Now Playing
      // surfaces even though we don't persist taxonomy on `PlaylistItem` yet.
      ...(result.tracksMeta ? { tracksMeta: result.tracksMeta } : {}),
    });
  } catch (e) {
    if (e instanceof EntitlementLimitError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    if (e instanceof AiPlaylistNoStrongMatchesError) {
      // 422 + structured payload: the renderer recognizes `kind: "no_strong_matches"`
      // and shows a localized "no strong matches; refine the prompt or scan more
      // local music" message instead of an opaque 500 error.
      return NextResponse.json(
        {
          error: e.message,
          kind: e.kind,
          intentLabel: e.intentLabel,
          shortfallHint: {
            kind: "short_accurate",
            matchedCount: e.matchedCount,
            intentLabel: e.intentLabel,
          },
        },
        { status: 422 },
      );
    }
    console.error("[api/playlists/ai-build] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI playlist build failed" },
      { status: 500 },
    );
  }
}

function playlistTenantScoped(playlist: { tenantId?: string }, userTenantId: string): boolean {
  if (playlist.tenantId && playlist.tenantId === userTenantId) return true;
  if (!playlist.tenantId && userTenantId === "tnt-default") return true;
  return false;
}
