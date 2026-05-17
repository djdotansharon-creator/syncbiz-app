import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE_NAME } from "@/lib/active-workspace-constants";
import { getCurrentUserFromApiRequest } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { daypartSlugSchema } from "@/lib/recommendations/fit-rules.types";
import { computeDjCreatorCoverage } from "@/lib/recommendations/dj-creator-coverage";
import {
  parseDjCreatorMatrixKeyFromApi,
  resolveDjSmartSearchDjContext,
  uniqLowerSlugs,
} from "@/lib/recommendations/dj-creator-search-context";
import { runSmartCatalogSearch } from "@/lib/recommendations/smart-catalog-search";
import type { WorkspaceFitContext } from "@/lib/recommendations/score-catalog-fit";

export const dynamic = "force-dynamic";

function clampLimit(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 25;
  if (!Number.isFinite(n)) return 25;
  return Math.min(100, Math.max(1, n));
}

function serializeProfile(p: WorkspaceFitContext) {
  return {
    primaryBusinessType: p.primaryBusinessType,
    audienceDescriptors: p.audienceDescriptors,
    energyLevel: p.energyLevel,
    preferredStyleHints: p.preferredStyleHints,
    desiredMoodNotes: p.desiredMoodNotes,
    conceptTags: p.conceptTags ?? [],
  };
}

/**
 * Authenticated read-only smart catalog search (Stage 6) for in-app surfaces (e.g. DJ Creator AI).
 * Music Programming Coverage in the response composes separate dimensions (genre/style/fit/daypart/etc.);
 * the `coverage` tier is a combined heuristic — see `computeDjCreatorCoverage`.
 * Does not enqueue playback or modify playlists.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromApiRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) {
    return NextResponse.json({ error: "Query required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const cookieWs = cookieStore.get(ACTIVE_WORKSPACE_COOKIE_NAME)?.value?.trim() ?? "";
  const workspaceId = cookieWs.length > 0 ? cookieWs : null;

  const daypartRaw = req.nextUrl.searchParams.get("daypart")?.trim() ?? "";
  const daypartParsed = daypartSlugSchema.safeParse(daypartRaw);
  const daypartOverride = daypartParsed.success ? daypartParsed.data : null;

  const limit = clampLimit(req.nextUrl.searchParams.get("limit"));

  const avoidSlugsRaw = req.nextUrl.searchParams.get("avoidSlugs")?.trim() ?? "";
  const avoidStyleSlugs = avoidSlugsRaw
    ? avoidSlugsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

  const djCx = parseDjCreatorMatrixKeyFromApi(req.nextUrl.searchParams.get("djCx"));
  const djCtxResolved = resolveDjSmartSearchDjContext(djCx);

  const mergedAvoid = uniqLowerSlugs([...avoidStyleSlugs, ...(djCtxResolved?.extraAvoidSlugs ?? [])]);

  const data = await runSmartCatalogSearch({
    query: q,
    workspaceId,
    daypartOverride,
    limit,
    avoidStyleSlugs: mergedAvoid.length > 0 ? mergedAvoid : undefined,
    djContext: djCtxResolved ?? undefined,
  });

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  });
  const isSuperAdmin = dbUser?.role === "SUPER_ADMIN";

  const coverage = computeDjCreatorCoverage(
    data.rows.map((r) => ({ displayScore: r.displayScore, matchedTags: r.matchedTags })),
    {
      businessType: data.parsed.businessType,
      matchedPhrases: data.parsed.matchedPhrases,
      styleTaxonomySlugs: data.parsed.styleTaxonomySlugs,
      moodHints: data.parsed.moodHints,
      conceptTags: data.parsed.conceptTags,
    },
    data.parserTaxonomyInDictionary,
  );

  return NextResponse.json({
    kind: "syncbiz_catalog_smart_search_v1",
    isSuperAdmin,
    coverage,
    djAvoidStyleFilterApplied: data.djAvoidStyleFilterApplied,
    eligibilityFilterEnabled: data.eligibilityFilterEnabled,
    filteredOutBlockedCount: data.filteredOutBlockedCount,
    filteredOutLimitedCount: data.filteredOutLimitedCount,
    parsed: data.parsed,
    profileUsed: serializeProfile(data.profileUsed),
    coarseDaypart: data.coarseDaypart,
    vibeSegment: data.vibeSegment,
    fitRulesVersion: data.fitRulesVersion,
    vibeRulesVersion: data.vibeRulesVersion,
    dictSlugCount: data.dictSlugCount,
    parserTaxonomyInDictionary: data.parserTaxonomyInDictionary,
    rows: data.rows.map((r) => ({
      catalogItemId: r.catalogItemId,
      title: r.title,
      url: r.url,
      thumbnail: r.thumbnail,
      provider: r.provider,
      durationSec: r.durationSec,
      curationRating: r.curationRating,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      displayScore: r.displayScore,
      baseFitScore: r.baseFitScore,
      matchedTags: r.matchedTags,
      recommendedBecause: r.recommendedBecause,
      ...(r.taxonomySlugs ? { taxonomySlugs: r.taxonomySlugs } : {}),
    })),
  });
}
