/**
 * Stage 12 — pure-logic verification for the catalog eligibility helpers.
 *
 * The repo has no unit-test framework configured (only Playwright for E2E).
 * This script exercises `assessCatalogItemReadiness` + `assessCatalogItemEligibility`
 * on representative synthetic rows and asserts that the tiering is what
 * `runSmartCatalogSearch` will see when `SYNCBIZ_ENFORCE_CATALOG_ELIGIBILITY=1`.
 *
 * Run:
 *   npx tsx scripts/verify-catalog-eligibility-filter.ts
 *
 * Exit code: 0 on success, 1 on any assertion failure.
 */

import { assessCatalogItemReadiness } from "@/lib/recommendations/catalog-item-readiness";
import { assessCatalogItemEligibility } from "@/lib/recommendations/catalog-item-eligibility";
import { isCatalogEligibilityEnforcementEnabled } from "@/lib/recommendations/catalog-eligibility-flag";
import type { MusicTaxonomyCategory } from "@prisma/client";

type Case = {
  name: string;
  input: Parameters<typeof assessCatalogItemReadiness>[0];
  expectLevel: "eligible" | "limited" | "blocked";
  expectStrictPasses: boolean;
};

const ALL_CATS: MusicTaxonomyCategory[] = [
  "MAIN_SOUND_GENRE",
  "STYLE_TAGS",
  "BUSINESS_FIT",
  "DAYPART_FIT",
];

const cases: Case[] = [
  {
    name: "ready item with energy → eligible, strict passes",
    input: {
      url: "https://www.youtube.com/watch?v=abc",
      provider: "youtube",
      durationSec: 180,
      thumbnail: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      manualEnergyRating: 7,
      linkedCategories: ALL_CATS,
    },
    expectLevel: "eligible",
    expectStrictPasses: true,
  },
  {
    name: "ready item missing thumbnail → still eligible (warning only)",
    input: {
      url: "https://www.youtube.com/watch?v=abc",
      provider: "youtube",
      durationSec: 180,
      thumbnail: null,
      manualEnergyRating: 7,
      linkedCategories: ALL_CATS,
    },
    expectLevel: "eligible",
    expectStrictPasses: true,
  },
  {
    name: "missing energy + missing daypart → partial → limited, strict drops",
    input: {
      url: "https://www.youtube.com/watch?v=abc",
      provider: "youtube",
      durationSec: 180,
      thumbnail: "x",
      manualEnergyRating: null,
      linkedCategories: ["MAIN_SOUND_GENRE", "STYLE_TAGS", "BUSINESS_FIT"],
    },
    expectLevel: "limited",
    expectStrictPasses: false,
  },
  {
    name: "missing 3+ dimensions → needs-work → blocked, strict drops",
    input: {
      url: "https://www.youtube.com/watch?v=abc",
      provider: "youtube",
      durationSec: 180,
      thumbnail: "x",
      manualEnergyRating: null,
      linkedCategories: ["MAIN_SOUND_GENRE"],
    },
    expectLevel: "blocked",
    expectStrictPasses: false,
  },
  {
    name: "unknown URL type → forced needs-work → blocked, strict drops",
    input: {
      url: "not-a-real-url",
      provider: null,
      durationSec: 180,
      thumbnail: "x",
      manualEnergyRating: 5,
      linkedCategories: ALL_CATS,
    },
    expectLevel: "blocked",
    expectStrictPasses: false,
  },
  {
    name: "PLAYBACK_CONTEXT substitutes for BUSINESS_FIT → eligible",
    input: {
      url: "https://www.youtube.com/watch?v=abc",
      provider: "youtube",
      durationSec: 180,
      thumbnail: "x",
      manualEnergyRating: 5,
      linkedCategories: ["MAIN_SOUND_GENRE", "STYLE_TAGS", "PLAYBACK_CONTEXT", "DAYPART_FIT"],
    },
    expectLevel: "eligible",
    expectStrictPasses: true,
  },
];

let failures = 0;
for (const c of cases) {
  const readiness = assessCatalogItemReadiness(c.input);
  const elig = assessCatalogItemEligibility({ readiness, archivedAt: null });
  const strictPasses = elig.canUseInDjCreator;

  const levelOk = elig.eligibilityLevel === c.expectLevel;
  const strictOk = strictPasses === c.expectStrictPasses;
  const ok = levelOk && strictOk;

  const mark = ok ? "OK  " : "FAIL";
  console.log(
    `[${mark}] ${c.name}  →  level=${elig.eligibilityLevel} (expect ${c.expectLevel}), strict=${strictPasses} (expect ${c.expectStrictPasses})`,
  );
  if (!ok) failures++;
}

console.log("");
console.log(
  `flag check: SYNCBIZ_ENFORCE_CATALOG_ELIGIBILITY=${process.env.SYNCBIZ_ENFORCE_CATALOG_ELIGIBILITY ?? "<unset>"} → enforcement ${isCatalogEligibilityEnforcementEnabled() ? "ON" : "OFF"}`,
);

if (failures > 0) {
  console.error(`\n${failures} case(s) failed.`);
  process.exit(1);
}
console.log("\nAll cases passed.");
