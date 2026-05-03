/**
 * Maps DJ Creator wizard picks → tight smart-search envelope (avoid slugs + energy gates).
 */

import bundle from "@/lib/recommendations/dj-creator-business-matrix.json";
import { isGymHighEnergyWizardVibes } from "@/lib/recommendations/dj-creator-rules";

const typedBundle = bundle as {
  version: number;
  contexts: Record<
    string,
    {
      manualEnergyRatingMax: number | null;
      manualEnergyRatingMin: number | null;
      extraAvoidSlugs: string[];
      unknownEnergyRejectIfIntersect: string[];
      strictTagOverlapOnly: boolean;
      noRelaxIntoUntaggedFallback: boolean;
    }
  >;
};

export type DjCreatorMatrixKey =
  | "spa_wellness"
  | "hospitality_calm"
  | "gym_high_default"
  | "gym_recovery"
  | "bar_relaxed"
  | "bar_night";

export type DjCreatorWizardMatrixHints = {
  businessId: string;
  vibeId: string;
  daypartId: string;
  gymIntensityId: string;
};

const HOSPITALITY_VIBES = new Set(["calm", "premium", "romantic"]);

/** Allowlist aligned with dj-creator-business-matrix.json */
const MATRIX_KEYS = new Set<string>([
  "spa_wellness",
  "hospitality_calm",
  "gym_high_default",
  "gym_recovery",
  "bar_relaxed",
  "bar_night",
]);

export function parseDjCreatorMatrixKeyFromApi(raw: string | null): DjCreatorMatrixKey | null {
  const k = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!k || !MATRIX_KEYS.has(k)) return null;
  return k as DjCreatorMatrixKey;
}

export function computeDjCreatorMatrixKey(hints: DjCreatorWizardMatrixHints): DjCreatorMatrixKey | null {
  const b = String(hints.businessId ?? "").trim().toLowerCase();
  const v = String(hints.vibeId ?? "").trim().toLowerCase();
  const d = String(hints.daypartId ?? "").trim().toLowerCase();
  const gi = String(hints.gymIntensityId ?? "").trim().toLowerCase();

  // 4. Spa / wellness (dedicated wizard business)
  if (b === "spa") return "spa_wellness";

  // 2. Gym
  if (b === "gym" && isGymHighEnergyWizardVibes(hints.businessId, hints.vibeId)) {
    return gi === "warmup" ? "gym_recovery" : "gym_high_default";
  }

  // 3. Bar / nightlife
  if (b === "bar") {
    const nightRhythmic = v === "rhythmic" || v === "energy" || d === "night";
    return nightRhythmic ? "bar_night" : "bar_relaxed";
  }

  // 1. Hospitality calm / premium
  if (HOSPITALITY_VIBES.has(v)) {
    if (b === "hotel" || b === "restaurant") return "hospitality_calm";
    if (b === "cafe" && d === "morning" && v === "calm") return "hospitality_calm";
  }

  return null;
}

export type DjSmartSearchDjContext = {
  matrixKey: DjCreatorMatrixKey;
  manualEnergyRatingMax: number | null;
  manualEnergyRatingMin: number | null;
  extraAvoidSlugs: string[];
  unknownEnergyRejectIfIntersect: string[];
  strictTagOverlapOnly: boolean;
};

export function resolveDjSmartSearchDjContext(matrixKey: DjCreatorMatrixKey | null): DjSmartSearchDjContext | null {
  if (!matrixKey) return null;
  const row = typedBundle.contexts[matrixKey];
  if (!row) return null;
  return {
    matrixKey,
    manualEnergyRatingMax: row.manualEnergyRatingMax ?? null,
    manualEnergyRatingMin: row.manualEnergyRatingMin ?? null,
    extraAvoidSlugs: [...row.extraAvoidSlugs],
    unknownEnergyRejectIfIntersect: [...row.unknownEnergyRejectIfIntersect],
    strictTagOverlapOnly: Boolean(row.strictTagOverlapOnly),
  };
}

export function uniqLowerSlugs(slugs: string[]): string[] {
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
