/**
 * Stage 9 — Per-item readiness quality gate for CatalogItem rows.
 *
 * Pure read-only helper: classifies a single catalog item as ready / partial /
 * needs-work based on its taxonomy link categories, manual energy rating,
 * URL type, and basic provider/duration metadata. Does not mutate data,
 * apply tags, or change scoring.
 *
 * Rules (per product spec):
 *   Ready (all of):
 *     - ≥1 MAIN_SOUND_GENRE link
 *     - ≥1 STYLE_TAGS link
 *     - ≥1 BUSINESS_FIT or PLAYBACK_CONTEXT link
 *     - ≥1 DAYPART_FIT link
 *     - manualEnergyRating ∈ [1, 10]
 *     - durationSec > 0  OR  source metadata indicates type clearly (provider known)
 *     - URL type recognized (not UNKNOWN)
 *     - thumbnail present → warning only when missing, not a hard fail
 *   Partial:
 *     - 1–2 hard-fail dimensions missing
 *   Needs work:
 *     - 3+ hard-fail dimensions missing, OR
 *     - URL type not recognized, OR
 *     - manualEnergyRating unset AND no duration AND no provider metadata
 */

import type { MusicTaxonomyCategory } from "@prisma/client";
import { inferCatalogItemUrlType } from "./catalog-coverage-health";

export type CatalogReadinessStatus = "ready" | "partial" | "needs-work";

export type CatalogReadinessDimensionKey =
  | "genre"
  | "style"
  | "businessFitOrContext"
  | "daypart"
  | "manualEnergy"
  | "urlType"
  | "metadata"
  | "thumbnail";

export type CatalogReadinessAssessment = {
  status: CatalogReadinessStatus;
  hardMissing: CatalogReadinessDimensionKey[];
  warnings: CatalogReadinessDimensionKey[];
  summary: string;
};

export type CatalogReadinessInput = {
  url: string;
  provider: string | null;
  durationSec: number | null;
  thumbnail: string | null;
  manualEnergyRating: number | null;
  /** Categories of currently-saved taxonomy links on the item. */
  linkedCategories: MusicTaxonomyCategory[];
};

export const CATALOG_READINESS_DIMENSION_LABEL: Record<CatalogReadinessDimensionKey, string> = {
  genre: "genre / main sound",
  style: "style / feel",
  businessFitOrContext: "business fit or playback context",
  daypart: "daypart",
  manualEnergy: "manual energy 1–10",
  urlType: "URL type",
  metadata: "duration / source metadata",
  thumbnail: "thumbnail / cover",
};

export const CATALOG_READINESS_DIMENSION_SHORT: Record<CatalogReadinessDimensionKey, string> = {
  genre: "Genre",
  style: "Style",
  businessFitOrContext: "Fit / Context",
  daypart: "Daypart",
  manualEnergy: "Energy",
  urlType: "URL type",
  metadata: "Metadata",
  thumbnail: "Thumbnail",
};

export function assessCatalogItemReadiness(input: CatalogReadinessInput): CatalogReadinessAssessment {
  const cats = new Set<MusicTaxonomyCategory>(input.linkedCategories);
  const hard: CatalogReadinessDimensionKey[] = [];
  const warn: CatalogReadinessDimensionKey[] = [];

  if (!cats.has("MAIN_SOUND_GENRE")) hard.push("genre");
  if (!cats.has("STYLE_TAGS")) hard.push("style");
  if (!cats.has("BUSINESS_FIT") && !cats.has("PLAYBACK_CONTEXT")) hard.push("businessFitOrContext");
  if (!cats.has("DAYPART_FIT")) hard.push("daypart");

  const energy = input.manualEnergyRating;
  const energyOk = energy != null && energy >= 1 && energy <= 10;
  if (!energyOk) hard.push("manualEnergy");

  const urlType = inferCatalogItemUrlType(input.url, input.provider);
  const urlTypeKnown = urlType != null;
  if (!urlTypeKnown) hard.push("urlType");

  const hasDuration = input.durationSec != null && input.durationSec > 0;
  const providerKnown = (input.provider ?? "").trim().length > 0;
  const metadataOk = hasDuration || providerKnown;
  if (!metadataOk) hard.push("metadata");

  const hasThumb = !!(input.thumbnail && input.thumbnail.trim().length > 0);
  if (!hasThumb) warn.push("thumbnail");

  let status: CatalogReadinessStatus;
  if (hard.length === 0) status = "ready";
  else if (hard.length <= 2) status = "partial";
  else status = "needs-work";

  // Spec overrides — these always demote to needs-work regardless of count.
  if (!urlTypeKnown) status = "needs-work";
  if (energy == null && !metadataOk) status = "needs-work";

  const reasons = hard.map((k) => CATALOG_READINESS_DIMENSION_LABEL[k]);
  const warnReasons = warn.map((k) => CATALOG_READINESS_DIMENSION_LABEL[k]);
  const summary =
    status === "ready"
      ? warnReasons.length > 0
        ? `Ready — warnings: ${warnReasons.join(", ")}.`
        : "Ready for coverage / programming use."
      : status === "partial"
        ? `Partial — missing ${reasons.join(", ")}.`
        : `Needs work — missing ${reasons.join(", ")}.`;

  return { status, hardMissing: hard, warnings: warn, summary };
}
