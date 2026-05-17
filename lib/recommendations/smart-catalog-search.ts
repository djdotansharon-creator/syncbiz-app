/**
 * Stage 6 V1 — orchestrates deterministic smart catalog search (parser + existing fit scoring).
 */

import type { MusicTaxonomyCategory, WorkspaceBusinessProfile } from "@prisma/client";
import type { DaypartSegment } from "@/lib/recommendations/business-daypart-vibe.types";
import { prisma } from "@/lib/prisma";
import { loadValidatedFitRules } from "@/lib/recommendations/load-fit-rules";
import { loadBusinessDaypartVibeRules } from "@/lib/recommendations/load-business-daypart-vibe";
import {
  daypartSlugSchema,
  type DaypartSlug,
} from "@/lib/recommendations/fit-rules.types";
import {
  rankCatalogItemsByFit,
  type CatalogFitScoreRow,
  type WorkspaceFitContext,
} from "@/lib/recommendations/score-catalog-fit";
import { resolveDaypartSegment } from "@/lib/recommendations/daypart-segment-map";
import {
  parseSmartCatalogQuery,
  type ParsedSmartCatalogQuery,
} from "@/lib/recommendations/parse-smart-catalog-query";
import { catalogDiscoveryActiveWhere } from "@/lib/catalog-discovery-scope";
import type { DjSmartSearchDjContext } from "@/lib/recommendations/dj-creator-search-context";
import { assessCatalogItemReadiness } from "@/lib/recommendations/catalog-item-readiness";
import { assessCatalogItemEligibility } from "@/lib/recommendations/catalog-item-eligibility";
import { isCatalogEligibilityEnforcementEnabled } from "@/lib/recommendations/catalog-eligibility-flag";

const MAX_CATALOG_SCAN = 4000;
const CURATION_WEIGHT = 0.012;
const POP_LOG_WEIGHT = 0.004;

export type SmartCatalogSearchResultRow = CatalogFitScoreRow & {
  url: string;
  /** CatalogItem.thumbnail — HTTPS URL or null (not a stored file). */
  thumbnail: string | null;
  provider: string | null;
  durationSec: number | null;
  curationRating: number;
  viewCount: number | null;
  likeCount: number | null;
  /** Fit score before tiny editorial / popularity bumps. */
  baseFitScore: number;
  /** After curation + log-pop boosts (display ranking). */
  displayScore: number;
  /** Single plain line for operators. */
  recommendedBecause: string;
  /** All taxonomy slugs on the item (only when DJ Creator avoid filter ran). */
  taxonomySlugs?: string[];
};

export type SmartCatalogSearchResponse = {
  parsed: ParsedSmartCatalogQuery;
  profileUsed: WorkspaceFitContext;
  coarseDaypart: DaypartSlug;
  /** Effective vibe segment passed to the matrix. */
  vibeSegment: DaypartSegment;
  fitRulesVersion: number;
  vibeRulesVersion: number;
  rows: SmartCatalogSearchResultRow[];
  dictSlugCount: number;
  /** Parser style slugs that exist in `MusicTaxonomyTag`. */
  parserTaxonomyInDictionary: string[];
  /** Set when `avoidStyleSlugs` was non-empty — full-tag-set exclusion for DJ Creator. */
  djAvoidStyleFilterApplied: boolean;
  /** Present when DJ Creator passed a strict matrix key. */
  djMatrixKey?: string | null;
  /** Stage 12 — true iff the SYNCBIZ_ENFORCE_CATALOG_ELIGIBILITY flag actively filtered this run. */
  eligibilityFilterEnabled: boolean;
  /** Items dropped because eligibility tier was `blocked` (only set when filter ran). */
  filteredOutBlockedCount: number;
  /** Items dropped because eligibility tier was `limited` (only set when filter ran). */
  filteredOutLimitedCount: number;
};

function mapProfile(
  row: Pick<
    WorkspaceBusinessProfile,
    | "primaryBusinessType"
    | "audienceDescriptors"
    | "energyLevel"
    | "preferredStyleHints"
    | "blockedStyleHints"
    | "desiredMoodNotes"
    | "cuisineOrConcept"
    | "conceptTags"
    | "daypartPreferences"
  >,
): WorkspaceFitContext {
  return {
    primaryBusinessType: row.primaryBusinessType,
    audienceDescriptors: row.audienceDescriptors,
    energyLevel: row.energyLevel,
    preferredStyleHints: row.preferredStyleHints,
    blockedStyleHints: row.blockedStyleHints,
    desiredMoodNotes: row.desiredMoodNotes,
    cuisineOrConcept: row.cuisineOrConcept,
    conceptTags: row.conceptTags,
    daypartPreferences: row.daypartPreferences ?? null,
  };
}

function mergeHintLists(base: string[], extra: string[]): string[] {
  const out = [...base];
  const seen = new Set(base.map((s) => s.trim().toLowerCase()));
  for (const x of extra) {
    const k = x.trim().toLowerCase();
    if (k.length < 1 || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/** Build workspace context from optional DB profile + parsed query tokens. */
export function buildSmartSearchProfile(args: {
  workspaceProfile: WorkspaceBusinessProfile | null;
  parsed: ParsedSmartCatalogQuery;
}): WorkspaceFitContext {
  const { workspaceProfile, parsed } = args;

  if (workspaceProfile) {
    const base = mapProfile(workspaceProfile);
    const mergedMoodNotes = [base.desiredMoodNotes, parsed.moodHints.join("; ")]
      .filter((s): s is string => Boolean(s && String(s).trim()))
      .join("; ");

    return {
      ...base,
      primaryBusinessType: parsed.businessType ?? base.primaryBusinessType,
      energyLevel: parsed.energyHint ?? base.energyLevel,
      preferredStyleHints: mergeHintLists(
        mergeHintLists(base.preferredStyleHints, parsed.styleTaxonomySlugs),
        parsed.moodHints,
      ),
      audienceDescriptors: mergeHintLists(base.audienceDescriptors, parsed.audienceHints),
      desiredMoodNotes: mergedMoodNotes.length > 0 ? mergedMoodNotes : base.desiredMoodNotes,
      conceptTags: mergeHintLists(base.conceptTags ?? [], parsed.conceptTags),
    };
  }

  return {
    primaryBusinessType: parsed.businessType ?? "OTHER",
    audienceDescriptors: parsed.audienceHints,
    energyLevel: parsed.energyHint,
    preferredStyleHints: mergeHintLists([...parsed.styleTaxonomySlugs], parsed.moodHints),
    blockedStyleHints: [],
    desiredMoodNotes: parsed.moodHints.length ? parsed.moodHints.join("; ") : null,
    cuisineOrConcept: null,
    conceptTags: parsed.conceptTags,
    daypartPreferences: null,
  };
}

function popBoost(viewCount: number | null): number {
  if (viewCount == null || viewCount < 1) return 0;
  return POP_LOG_WEIGHT * Math.log10(viewCount + 1);
}

/** Normalize DJ Creator rule slugs for comparison with DB taxonomy case-insensitively. */
function normalizeAvoidStyleSlugs(slugs: string[] | undefined): string[] {
  if (!slugs?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of slugs) {
    const k = s.trim().toLowerCase();
    if (k.length < 1 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function catalogSlugSetIntersectsAvoid(slugSet: ReadonlySet<string>, avoidLc: ReadonlySet<string>): boolean {
  for (const s of slugSet) {
    if (avoidLc.has(s.toLowerCase())) return true;
  }
  return false;
}

function passesDjContextEnergyRow(
  slugSet: ReadonlySet<string>,
  manualRating: number | null | undefined,
  ctx: DjSmartSearchDjContext,
): boolean {
  const m = manualRating != null && Number.isFinite(manualRating) ? manualRating : null;
  if (m != null && m >= 1 && m <= 10) {
    if (ctx.manualEnergyRatingMax != null && m > ctx.manualEnergyRatingMax) return false;
    if (ctx.manualEnergyRatingMin != null && m < ctx.manualEnergyRatingMin) return false;
    return true;
  }
  if ((m == null || m < 1 || m > 10) && ctx.unknownEnergyRejectIfIntersect.length > 0) {
    const avoidLc = new Set(ctx.unknownEnergyRejectIfIntersect.map((s) => s.trim().toLowerCase()).filter(Boolean));
    if (avoidLc.size > 0 && catalogSlugSetIntersectsAvoid(slugSet, avoidLc)) return false;
  }
  return true;
}

function buildRecommendedBecause(
  row: CatalogFitScoreRow,
  parsed: ParsedSmartCatalogQuery,
  baseFit: number,
  cB: number,
  pB: number,
): string {
  const parts: string[] = [];
  parts.push(`Base catalog fit score ${baseFit.toFixed(3)} from taxonomy rules`);
  if (parsed.matchedPhrases.length) {
    parts.push(`aligned with your query cues (${[...new Set(parsed.matchedPhrases)].slice(0, 6).join(", ")})`);
  }
  if (row.matchedTags.length) {
    parts.push(`matching item tags: ${row.matchedTags.slice(0, 8).join(", ")}`);
  } else {
    parts.push("no overlapping taxonomy tags — low fit");
  }
  if (row.businessDaypartVibe && row.businessDaypartVibe.deltaVibe !== 0) {
    parts.push(`business × daypart vibe ${row.businessDaypartVibe.deltaVibe >= 0 ? "+" : ""}${row.businessDaypartVibe.deltaVibe.toFixed(4)}`);
  }
  if (cB > 0) parts.push(`tiny curation boost +${cB.toFixed(4)}`);
  if (pB > 0) parts.push(`optional popularity hint +${pB.toFixed(4)}`);
  return `Recommended because ${parts.join("; ")}.`;
}

export async function runSmartCatalogSearch(args: {
  query: string;
  workspaceId: string | null;
  daypartOverride: DaypartSlug | null;
  limit: number;
  /**
   * Optional: when non-empty, exclude catalog rows whose full taxonomy slug set
   * intersects this list (DJ Creator matched-rule avoidStyleSlugs). No effect on scoring.
   */
  avoidStyleSlugs?: string[];
  /** DJ Creator Stage 6 matrix — energy gates + forbid untagged backfill. */
  djContext?: DjSmartSearchDjContext | null;
}): Promise<SmartCatalogSearchResponse> {
  const parsed = parseSmartCatalogQuery(args.query);
  const coarseDaypart: DaypartSlug =
    args.daypartOverride ?? daypartSlugSchema.parse(parsed.coarseDaypart);

  const dictRows = await prisma.musicTaxonomyTag.findMany({ select: { slug: true } });
  const dictSlugSet = new Set(dictRows.map((r) => r.slug));
  const parserTaxonomyInDictionary = parsed.styleTaxonomySlugs.filter((s) => dictSlugSet.has(s));

  const workspaceRow =
    args.workspaceId && args.workspaceId.trim().length > 0
      ? await prisma.workspace.findUnique({
          where: { id: args.workspaceId.trim() },
          select: {
            businessProfile: true,
          },
        })
      : null;

  const profileUsed = buildSmartSearchProfile({
    workspaceProfile: workspaceRow?.businessProfile ?? null,
    parsed,
  });

  const segmentEffective = resolveDaypartSegment({
    segmentParam: args.daypartOverride ? "" : parsed.vibeSegment,
    primaryBusinessType: profileUsed.primaryBusinessType,
    coarseDaypart,
  });

  const { rulesBySlug, version: fitV } = loadValidatedFitRules();
  const vibeLoaded = loadBusinessDaypartVibeRules();

  const catalogRowsRaw = await prisma.catalogItem.findMany({
    where: {
      AND: [{ taxonomyLinks: { some: {} } }, catalogDiscoveryActiveWhere],
    },
    take: MAX_CATALOG_SCAN,
    select: {
      id: true,
      title: true,
      url: true,
      provider: true,
      durationSec: true,
      thumbnail: true,
      curationRating: true,
      manualEnergyRating: true,
      taxonomyLinks: {
        select: { taxonomyTag: { select: { slug: true, category: true } } },
      },
      catalogSourceSnapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
        select: { viewCount: true, likeCount: true },
      },
    },
  });

  const categoriesById = new Map<string, MusicTaxonomyCategory[]>(
    catalogRowsRaw.map((row) => [
      row.id,
      row.taxonomyLinks.map((l) => l.taxonomyTag.category),
    ] as const),
  );

  const snapById = new Map<
    string,
    { viewCount: number | null; likeCount: number | null }
  >();
  for (const row of catalogRowsRaw) {
    const s = row.catalogSourceSnapshots[0];
    snapById.set(row.id, {
      viewCount: s?.viewCount ?? null,
      likeCount: s?.likeCount ?? null,
    });
  }

  const catalogInputs = catalogRowsRaw.map((row) => ({
    id: row.id,
    title: row.title,
    slugSet: new Set(row.taxonomyLinks.map((l) => l.taxonomyTag.slug)),
  }));

  const slugSetById = new Map(catalogInputs.map((r) => [r.id, r.slugSet] as const));

  const ranked = rankCatalogItemsByFit({
    profile: profileUsed,
    daypart: coarseDaypart,
    rulesBySlug,
    catalogRows: catalogInputs,
    limit: catalogInputs.length,
    vibeRulesByKey: vibeLoaded.rulesByKey,
    daypartSegment: segmentEffective,
  });

  const avoidListLc = normalizeAvoidStyleSlugs(args.avoidStyleSlugs);
  const avoidSetLc = new Set(avoidListLc);
  const djAvoidStyleFilterApplied = avoidSetLc.size > 0;

  const rankedAfterAvoid = djAvoidStyleFilterApplied
    ? ranked.filter((row) => {
        const set = slugSetById.get(row.catalogItemId);
        if (!set) return true;
        return !catalogSlugSetIntersectsAvoid(set, avoidSetLc);
      })
    : ranked;

  const metaById = new Map(catalogRowsRaw.map((r) => [r.id, r] as const));

  const limit = Math.min(100, Math.max(1, args.limit));
  const rescoreCap = Math.min(rankedAfterAvoid.length, Math.max(limit * 5, 80));
  let rankedRescorePool = rankedAfterAvoid.slice(0, rescoreCap);

  const djCtx = args.djContext ?? null;
  if (djCtx) {
    rankedRescorePool = rankedRescorePool.filter((row) => {
      const set = slugSetById.get(row.catalogItemId);
      if (!set) return true;
      const manual = metaById.get(row.catalogItemId)?.manualEnergyRating;
      return passesDjContextEnergyRow(set, manual, djCtx);
    });
  }

  // Stage 12 — gated eligibility enforcement on the DJ Creator strict path only.
  // Off by default. Non-DJ smart search (admin preview, library) is never affected
  // because djCtx is null on those paths.
  let filteredOutBlockedCount = 0;
  let filteredOutLimitedCount = 0;
  const eligibilityFilterEnabled = djCtx != null && isCatalogEligibilityEnforcementEnabled();
  if (eligibilityFilterEnabled) {
    rankedRescorePool = rankedRescorePool.filter((row) => {
      const meta = metaById.get(row.catalogItemId);
      const cats = categoriesById.get(row.catalogItemId) ?? [];
      if (!meta) return true;
      const readiness = assessCatalogItemReadiness({
        url: meta.url,
        provider: meta.provider,
        durationSec: meta.durationSec,
        thumbnail: meta.thumbnail,
        manualEnergyRating: meta.manualEnergyRating,
        linkedCategories: cats,
      });
      // catalogDiscoveryActiveWhere already excludes archived rows, so archivedAt is null here.
      const elig = assessCatalogItemEligibility({ readiness, archivedAt: null });
      if (elig.canUseInDjCreator) return true;
      if (elig.eligibilityLevel === "blocked") filteredOutBlockedCount++;
      else if (elig.eligibilityLevel === "limited") filteredOutLimitedCount++;
      return false;
    });
  }

  const enriched: SmartCatalogSearchResultRow[] = rankedRescorePool.map((row) => {
    const meta = metaById.get(row.catalogItemId)!;
    const snap = snapById.get(row.catalogItemId)!;
    const baseFit = row.score;
    const cB = Math.max(0, meta.curationRating) * CURATION_WEIGHT;
    const pB = popBoost(snap.viewCount);
    const displayScore = Math.round((baseFit + cB + pB) * 10000) / 10000;

    const rowSlugSet = slugSetById.get(row.catalogItemId);
    const taxonomySlugsSorted =
      djAvoidStyleFilterApplied && rowSlugSet ? [...rowSlugSet].sort() : undefined;

    return {
      ...row,
      url: meta.url,
      thumbnail: meta.thumbnail,
      provider: meta.provider,
      durationSec: meta.durationSec,
      curationRating: meta.curationRating,
      viewCount: snap.viewCount,
      likeCount: snap.likeCount,
      baseFitScore: baseFit,
      displayScore,
      recommendedBecause: buildRecommendedBecause(row, parsed, baseFit, cB, pB),
      ...(taxonomySlugsSorted ? { taxonomySlugs: taxonomySlugsSorted } : {}),
    };
  });

  enriched.sort((a, b) => {
    if (b.displayScore !== a.displayScore) return b.displayScore - a.displayScore;
    return a.title.localeCompare(b.title);
  });

  const withOverlap = enriched.filter((r) => r.matchedTags.length > 0);
  const preferOverlap = djCtx?.strictTagOverlapOnly
    ? withOverlap
    : withOverlap.length > 0
      ? withOverlap
      : enriched;

  const rowsOut = preferOverlap.slice(0, limit);

  return {
    parsed,
    profileUsed,
    coarseDaypart,
    vibeSegment: segmentEffective,
    fitRulesVersion: fitV,
    vibeRulesVersion: vibeLoaded.version,
    rows: rowsOut,
    dictSlugCount: dictSlugSet.size,
    parserTaxonomyInDictionary,
    djAvoidStyleFilterApplied,
    eligibilityFilterEnabled,
    filteredOutBlockedCount,
    filteredOutLimitedCount,
    ...(djCtx ? { djMatrixKey: djCtx.matrixKey } : {}),
  };
}
