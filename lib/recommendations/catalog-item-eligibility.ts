/**
 * Stage 10 — Derived usage eligibility for CatalogItem rows (read-only V1).
 *
 * Readiness tells editors whether tagging/metadata is sufficient; eligibility
 * tells operators where an item is safe to use (DJ Creator, coverage packs,
 * smart search, library discovery). Pure — no DB writes, no auto-tagging.
 */

import {
  CATALOG_READINESS_DIMENSION_LABEL,
  type CatalogReadinessAssessment,
} from "./catalog-item-readiness";

export type CatalogEligibilityLevel = "eligible" | "limited" | "blocked" | "archived";

export type CatalogItemUsageEligibility = {
  eligibilityLevel: CatalogEligibilityLevel;
  canUseInDjCreator: boolean;
  canUseInCoverage: boolean;
  canUseInSmartSearch: boolean;
  canShowInLibraryDiscovery: boolean;
  blockedReasons: string[];
  warnings: string[];
  recommendedEditorAction: string;
};

export type CatalogItemUsageEligibilityInput = {
  readiness: CatalogReadinessAssessment;
  /** When set, item is treated as archived (hidden from discovery / catalog automation). */
  archivedAt?: Date | string | null;
};

const LEVEL_LABEL: Record<CatalogEligibilityLevel, string> = {
  eligible: "Eligible",
  limited: "Limited",
  blocked: "Blocked",
  archived: "Archived",
};

export function eligibilityLevelLabel(level: CatalogEligibilityLevel): string {
  return LEVEL_LABEL[level];
}

function isArchivedValue(archivedAt: Date | string | null | undefined): boolean {
  if (archivedAt == null) return false;
  if (archivedAt instanceof Date) return !Number.isNaN(archivedAt.getTime());
  return String(archivedAt).trim().length > 0;
}

function warnLinesFromReadiness(readiness: CatalogReadinessAssessment): string[] {
  const out: string[] = [];
  for (const k of readiness.warnings) {
    out.push(`${CATALOG_READINESS_DIMENSION_LABEL[k]} — warning only (not a hard block).`);
  }
  return out;
}

function baseLevelFromReadiness(status: CatalogReadinessAssessment["status"]): Exclude<CatalogEligibilityLevel, "archived"> {
  if (status === "ready") return "eligible";
  if (status === "partial") return "limited";
  return "blocked";
}

/**
 * Derives per-surface usage flags from Stage 9 readiness + archive state.
 *
 * V1 rules (summary):
 * - Archived → level archived; no discovery or automated flows.
 * - Ready (not archived) → eligible; all four can* true (strict surfaces).
 * - Partial → limited; smart search + discovery OK; DJ Creator / coverage strict false with reasons.
 * - Needs work → blocked from DJ Creator, coverage strict, and smart search; admin-only for fixing.
 * - Missing manual energy → blocks DJ Creator strict (also prevents “ready”).
 * - Unknown URL type → blocks coverage strict matching; demotes readiness to needs-work in Stage 9.
 * - Missing thumbnail → warning only.
 */
export function assessCatalogItemEligibility(
  input: CatalogItemUsageEligibilityInput,
): CatalogItemUsageEligibility {
  const { readiness, archivedAt } = input;
  const archived = isArchivedValue(archivedAt);

  if (archived) {
    return {
      eligibilityLevel: "archived",
      canUseInDjCreator: false,
      canUseInCoverage: false,
      canUseInSmartSearch: false,
      canShowInLibraryDiscovery: false,
      blockedReasons: ["Item is archived — hidden from library discovery and automated catalog flows."],
      warnings: warnLinesFromReadiness(readiness),
      recommendedEditorAction:
        "Unarchive this row if it should return to discovery, smart search, coverage packs, or DJ Creator.",
    };
  }

  const urlTypeUnknown = readiness.hardMissing.includes("urlType");

  const eligibilityLevel = baseLevelFromReadiness(readiness.status);
  const canShowInLibraryDiscovery = true;

  const canUseInDjCreator = readiness.status === "ready";

  const canUseInCoverage = readiness.status === "ready" && !urlTypeUnknown;

  const canUseInSmartSearch = readiness.status === "ready" || readiness.status === "partial";

  const blockedReasons: string[] = [];
  const warnings = warnLinesFromReadiness(readiness);

  if (urlTypeUnknown) {
    blockedReasons.push("Unknown URL type — not eligible for coverage strict matching.");
  }

  if (readiness.status === "needs-work") {
    const miss = readiness.hardMissing.map((k) => CATALOG_READINESS_DIMENSION_LABEL[k]);
    blockedReasons.push(
      miss.length > 0
        ? `Needs work — blocked from DJ Creator strict flows and smart search until fixed (missing: ${miss.join(", ")}).`
        : "Needs work — blocked from DJ Creator strict flows and smart search until fixed.",
    );
  } else if (readiness.status === "partial") {
    blockedReasons.push("Partial readiness — not eligible for DJ Creator strict packs or coverage strict matching.");
  }

  if (eligibilityLevel === "limited") {
    warnings.push(
      "Limited eligibility — usable in admin and smart search as a thinner row; tighten readiness before DJ/coverage strict use.",
    );
  }

  const dedupedBlocked = [...new Set(blockedReasons)];

  let recommendedEditorAction: string;
  if (eligibilityLevel === "eligible") {
    recommendedEditorAction =
      "Eligible for DJ Creator strict packs, coverage strict matching, and smart search — keep taxonomy and energy current.";
  } else if (eligibilityLevel === "limited") {
    recommendedEditorAction =
      "Finish the remaining readiness dimensions (see readiness chips) to move from limited to fully eligible.";
  } else {
    recommendedEditorAction = readiness.summary;
  }

  return {
    eligibilityLevel,
    canUseInDjCreator,
    canUseInCoverage,
    canUseInSmartSearch,
    canShowInLibraryDiscovery,
    blockedReasons: dedupedBlocked,
    warnings: [...new Set(warnings)],
    recommendedEditorAction,
  };
}

export function eligibilityShortSummary(e: CatalogItemUsageEligibility): string {
  const dj = e.canUseInDjCreator ? "DJ ✓" : "DJ ✗";
  const cov = e.canUseInCoverage ? "Cov ✓" : "Cov ✗";
  const srch = e.canUseInSmartSearch ? "Smart ✓" : "Smart ✗";
  const lib = e.canShowInLibraryDiscovery ? "Lib ✓" : "Lib ✗";
  return `${eligibilityLevelLabel(e.eligibilityLevel)} · ${dj} · ${cov} · ${srch} · ${lib}`;
}
