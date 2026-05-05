/**
 * Stage 12 — runtime enforcement gate for `assessCatalogItemEligibility`.
 *
 * V1 (Stages 9–10) ships the eligibility helpers as diagnostic-only. This
 * flag flips them into the runtime path of DJ Creator strict packs only.
 *
 * Default: OFF. Identical convention to `SYNCBIZ_ENFORCE_SUSPENSION` and
 * `SYNCBIZ_ENFORCE_LIMITS` — accepts only the literal string "1".
 *
 * Affected paths when ON:
 *   - `runSmartCatalogSearch` filters out rows whose eligibility tier is
 *     `blocked` or `limited` ONLY when a DJ Creator matrix `djContext` is
 *     present. Non-DJ smart search (admin preview, generic library search)
 *     is unchanged.
 *
 * Not affected:
 *   - Scoring weights (`CURATION_WEIGHT`, `POP_LOG_WEIGHT`).
 *   - Coverage strict matching (separate future flag).
 *   - Admin Workbench list / row pills (always show all readiness states).
 */

const ENV_KEY = "SYNCBIZ_ENFORCE_CATALOG_ELIGIBILITY";

export function isCatalogEligibilityEnforcementEnabled(): boolean {
  return process.env[ENV_KEY] === "1";
}

export const CATALOG_ELIGIBILITY_ENV_KEY = ENV_KEY;
