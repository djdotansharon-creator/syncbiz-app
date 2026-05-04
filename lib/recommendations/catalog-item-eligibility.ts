/**
 * Stage 10 — Per-item eligibility derived from readiness.
 *
 * Translates a CatalogItem readiness verdict into downstream-flow eligibility
 * (DJ Creator strict / loose, Coverage strict matching, admin visibility).
 * Pure, read-only — no DB writes, no scoring/filtering changes. Surfaced as
 * V1 visibility/diagnostic in admin UI; consumers may opt in later.
 *
 * Tier mapping (from readiness.status):
 *   ready      → fully-eligible
 *   partial    → limited       (admin/search OK; warn before DJ Creator)
 *   needs-work → blocked       (admin only; not used in DJ Creator selection)
 *
 * Hard-fail dimension overrides:
 *   manualEnergy missing → not eligible for DJ Creator strict packs
 *   urlType unknown      → not eligible for Coverage strict matching
 *
 * Soft (warning only):
 *   thumbnail missing    → not blocked; UI warning only
 */

import type {
  CatalogReadinessAssessment,
  CatalogReadinessDimensionKey,
} from "./catalog-item-readiness";

export type CatalogEligibilityTier = "fully-eligible" | "limited" | "blocked";

export type CatalogEligibilityAssessment = {
  tier: CatalogEligibilityTier;
  djCreatorStrictEligible: boolean;
  djCreatorAnyEligible: boolean;
  coverageStrictMatchEligible: boolean;
  adminVisible: boolean;
  reasons: string[];
  warnings: string[];
};

const ELIGIBILITY_TIER_LABEL: Record<CatalogEligibilityTier, string> = {
  "fully-eligible": "Fully eligible",
  limited: "Limited",
  blocked: "Blocked",
};

export function eligibilityTierLabel(tier: CatalogEligibilityTier): string {
  return ELIGIBILITY_TIER_LABEL[tier];
}

function hasMissing(
  readiness: CatalogReadinessAssessment,
  key: CatalogReadinessDimensionKey,
): boolean {
  return readiness.hardMissing.includes(key);
}

export function assessCatalogItemEligibility(
  readiness: CatalogReadinessAssessment,
): CatalogEligibilityAssessment {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const energyMissing = hasMissing(readiness, "manualEnergy");
  const urlTypeUnknown = hasMissing(readiness, "urlType");

  let tier: CatalogEligibilityTier;
  if (readiness.status === "ready") tier = "fully-eligible";
  else if (readiness.status === "partial") tier = "limited";
  else tier = "blocked";

  const adminVisible = true;

  const coverageStrictMatchEligible = !urlTypeUnknown;
  if (urlTypeUnknown) {
    reasons.push("Unknown URL type — excluded from Coverage strict matching.");
  }

  const djCreatorAnyEligible = readiness.status !== "needs-work";
  if (!djCreatorAnyEligible) {
    reasons.push("Needs work — admin only; not used in DJ Creator selection.");
  }

  const djCreatorStrictEligible = readiness.status === "ready" && !energyMissing;
  if (!djCreatorStrictEligible && djCreatorAnyEligible) {
    if (energyMissing) {
      reasons.push("Manual energy unset — not eligible for DJ Creator strict packs.");
    }
    if (readiness.status === "partial") {
      reasons.push("Partial readiness — limited in DJ Creator strict packs (warn before use).");
    }
  }

  if (readiness.warnings.length > 0) {
    warnings.push("Missing thumbnail — soft warning, not blocked.");
  }

  return {
    tier,
    djCreatorStrictEligible,
    djCreatorAnyEligible,
    coverageStrictMatchEligible,
    adminVisible,
    reasons,
    warnings,
  };
}

export function eligibilityShortSummary(elig: CatalogEligibilityAssessment): string {
  const dj = elig.djCreatorStrictEligible
    ? "DJ-strict ✓"
    : elig.djCreatorAnyEligible
      ? "DJ-strict ✗ (loose only)"
      : "DJ ✗ (admin only)";
  const cov = elig.coverageStrictMatchEligible ? "Cov-strict ✓" : "Cov-strict ✗";
  return `${eligibilityTierLabel(elig.tier)} · ${dj} · ${cov}`;
}
