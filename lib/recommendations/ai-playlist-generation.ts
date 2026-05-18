/**
 * MVP — catalog-first AI playlist builder (deterministic scoring via {@link runSmartCatalogSearch}).
 * Always persists a NEW playlist row; never mutates the seed.
 */

import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE_NAME } from "@/lib/active-workspace-constants";
import { ensurePlaylistTracksLinkedToCatalog } from "@/lib/catalog-store";
import { prisma } from "@/lib/prisma";
import { createPlaylist } from "@/lib/playlist-store";
import { inferPlaylistType } from "@/lib/playlist-utils";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import { buildPlaylistDna, type PlaylistDNA } from "@/lib/recommendations/ai-playlist-dna";
import {
  resolveDjSmartSearchDjContext,
  type DjCreatorMatrixKey,
} from "@/lib/recommendations/dj-creator-search-context";
import type { SmartCatalogSearchResultRow } from "@/lib/recommendations/smart-catalog-search";
import { runSmartCatalogSearch } from "@/lib/recommendations/smart-catalog-search";

export type AiPlaylistBuildMode = "prompt" | "similar" | "refine" | "expand";

const AI_PLAYLIST_GENRE = "AI Playlist";
const DEFAULT_TARGET = 50;
const ARTIST_CAP = 3;

function normUrl(u: string): string {
  return u.trim().toLowerCase().replace(/^https:\/\//, "http://");
}

async function hydrateCatalogSnapshotForPlaylistDna(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await prisma.catalogItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      url: true,
      artist: true,
      provider: true,
      durationSec: true,
      manualEnergyRating: true,
      taxonomyLinks: { select: { taxonomyTag: { select: { slug: true } } } },
      catalogSourceSnapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
        select: { publishedAt: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    artist: r.artist,
    provider: r.provider,
    durationSec: r.durationSec,
    manualEnergyRating: r.manualEnergyRating,
    taxonomySlugs: r.taxonomyLinks.map((l) => l.taxonomyTag.slug),
    publishedYear: r.catalogSourceSnapshots[0]?.publishedAt?.getFullYear() ?? null,
  }));
}

function pickDjMatrixFromDna(dna: PlaylistDNA | null): DjCreatorMatrixKey | null {
  if (!dna) return null;
  if (dna.avgManualEnergy != null && dna.avgManualEnergy <= 4.5) return "hospitality_calm";
  if (dna.energyLevelLabel === "low") return "hospitality_calm";
  if (dna.energyLevelLabel === "high") return "gym_high_default";
  return null;
}

function buildSearchQueries(args: {
  mode: AiPlaylistBuildMode;
  prompt: string;
  refinementPrompt: string;
  dna: PlaylistDNA | null;
}): string[] {
  const qMain: string[] = [];
  const p = args.prompt.trim();
  const rp = args.refinementPrompt.trim();
  if (p) qMain.push(p);
  if (args.mode === "refine" && rp) qMain.push(rp);
  if (args.mode === "expand" && rp) qMain.push(rp);
  if (args.dna && (args.mode === "similar" || args.mode === "refine" || args.mode === "expand")) {
    if (args.dna.keywordLine) qMain.push(args.dna.keywordLine);
  }
  if (args.mode === "expand") qMain.push("popular hits upbeat variety curated");
  const primary = qMain.join(" ").replace(/\s+/g, " ").trim();

  const out: string[] = [];
  if (primary.length > 0) out.push(primary);
  if (
    args.dna?.keywordLine &&
    !primary.includes(args.dna.keywordLine) &&
    (args.mode === "similar" || args.mode === "refine" || args.mode === "expand")
  ) {
    out.push(args.dna.keywordLine);
  }
  if (!out.some((x) => x.length > 0)) {
    out.push("popular curated mix lounge");
  }
  return out;
}

function mergeRankedDedup(rowsLists: SmartCatalogSearchResultRow[][]): SmartCatalogSearchResultRow[] {
  const best = new Map<string, SmartCatalogSearchResultRow>();
  for (const list of rowsLists) {
    for (const r of list) {
      const prev = best.get(r.catalogItemId);
      if (!prev || r.displayScore > prev.displayScore) best.set(r.catalogItemId, { ...r });
    }
  }
  return [...best.values()].sort((a, b) => b.displayScore - a.displayScore);
}

function selectTracks(
  ranked: SmartCatalogSearchResultRow[],
  target: number,
  dna: PlaylistDNA | null,
  mode: AiPlaylistBuildMode,
): { tracks: SmartCatalogSearchResultRow[]; shortfall: string | null } {
  const excludeCatalogIds = new Set(dna?.catalogIdsToExclude ?? []);
  const excludeUrls = new Set(dna?.urlsToExcludeNormalized ?? []);
  const artistUse = new Map<string, number>();
  const picked: SmartCatalogSearchResultRow[] = [];

  for (const row of ranked) {
    if (picked.length >= target) break;
    if (excludeCatalogIds.has(row.catalogItemId)) continue;
    const nu = normUrl(row.url);
    if (excludeUrls.has(nu)) continue;

    const artistKey = (row.artist ?? "").trim().toLowerCase();
    if (artistKey) {
      const u = artistUse.get(artistKey) ?? 0;
      if (u >= ARTIST_CAP) continue;
      artistUse.set(artistKey, u + 1);
    }

    picked.push(row);
  }

  let shortfall: string | null = null;
  if (picked.length < target) {
    shortfall = `Only ${picked.length} distinct catalog matches passed confidence, dedupe, and artist-cap rules — created a shorter playlist.`;
  }
  return { tracks: picked, shortfall };
}

async function workspaceIdFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  const ws = cookieStore.get(ACTIVE_WORKSPACE_COOKIE_NAME)?.value?.trim() ?? "";
  return ws.length ? ws : null;
}

export type AiPlaylistBuildOk = {
  ok: true;
  playlistId: string;
  name: string;
  trackCount: number;
  requestedCount: number;
  mode: AiPlaylistBuildMode;
  shortfallExplanation: string | null;
};

export async function executeAiPlaylistBuild(args: {
  tenantId: string;
  mode: AiPlaylistBuildMode;
  prompt?: string;
  refinementPrompt?: string;
  seedPlaylist: Playlist | null;
  branchId?: string;
  /** Target size (clamped server-side). */
  count?: number;
}): Promise<AiPlaylistBuildOk> {
  const targetMax = Math.min(50, Math.max(1, args.count ?? DEFAULT_TARGET));

  let dna: PlaylistDNA | null = null;
  if (args.seedPlaylist) {
    const catalogIdsInSeed = [...new Set(
      (args.seedPlaylist.tracks ?? [])
        .map((t) => (t.catalogItemId ?? "").trim())
        .filter(Boolean),
    )];
    const bundle = await hydrateCatalogSnapshotForPlaylistDna(catalogIdsInSeed);
    dna = buildPlaylistDna({ seed: args.seedPlaylist, catalogRows: bundle });
  }

  const queries = buildSearchQueries({
    mode: args.mode,
    prompt: args.prompt ?? "",
    refinementPrompt: args.refinementPrompt ?? "",
    dna,
  });

  const matrixKey = pickDjMatrixFromDna(dna);
  const djContext = resolveDjSmartSearchDjContext(matrixKey);
  const workspaceId = await workspaceIdFromCookies();
  const poolLimit = Math.min(140, Math.max(targetMax * 3, targetMax));

  const searchRuns: SmartCatalogSearchResultRow[][] = [];
  for (const q of queries) {
    const res = await runSmartCatalogSearch({
      query: q,
      workspaceId,
      daypartOverride: null,
      limit: poolLimit,
      maxResultLimit: 170,
      djContext,
    });
    searchRuns.push(res.rows);
  }

  const merged = mergeRankedDedup(searchRuns);
  merged.sort((a, b) => b.displayScore - a.displayScore);

  const { tracks: selected, shortfall } = selectTracks(merged, targetMax, dna, args.mode);

  const branchId = (args.branchId ?? "default").trim() || "default";

  const rawTracks = selected.map((r) => ({
    id: r.catalogItemId,
    name: r.title,
    type: inferPlaylistType(r.url),
    url: r.url,
    cover: r.thumbnail ?? undefined,
    catalogItemId: r.catalogItemId,
  }));

  const linked = await ensurePlaylistTracksLinkedToCatalog(args.tenantId, rawTracks);

  const seedName = args.seedPlaylist?.name?.trim() ?? "";
  let name: string;
  if (args.mode === "prompt") {
    const base = (args.prompt ?? "").trim();
    name = base.length > 0 ? base.slice(0, 120) : "AI playlist";
  } else if (args.mode === "similar") {
    name = seedName ? `${seedName} · AI similar` : "AI similar playlist";
  } else if (args.mode === "refine") {
    name = seedName ? `${seedName} · AI refined` : "AI refined playlist";
  } else {
    name = seedName ? `${seedName} · AI expanded` : "AI expanded playlist";
  }

  const firstUrl = linked[0]?.url?.trim() ?? "";
  if (!firstUrl) {
    throw new Error("AI playlist build produced no playable URL");
  }

  const typed = linked as PlaylistTrack[];

  const created = await createPlaylist({
    name,
    genre: AI_PLAYLIST_GENRE,
    type: typed[0]!.type,
    url: firstUrl,
    thumbnail: typed[0]?.cover ?? "",
    branchId,
    tenantId: args.tenantId,
    tracks: typed,
  });

  return {
    ok: true,
    playlistId: created.id,
    name: created.name,
    trackCount: typed.length,
    requestedCount: targetMax,
    mode: args.mode,
    shortfallExplanation: shortfall,
  };
}
