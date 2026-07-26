/**
 * One-off (re-runnable) seed generator for lib/recommendations/tag-packs.json.
 *
 * Reads lib/recommendations/fit-rules.json — the hand-authored genre→context map the
 * DJ scorer already trusts — and turns each genre/style rule into a "tag pack": a
 * SEED tag slug (the genre) + the RELATED cross-dimension tag slugs an admin should
 * usually add with it (BUSINESS_FIT, DAYPART_FIT, VIBE_ENERGY) + AVOID slugs
 * (from fit-rules avoidFor). Every emitted slug is validated against the live ACTIVE
 * taxonomy dictionary (read-only) so there are no dead suggestions.
 *
 * Prints the packs JSON to stdout — pipe/save into lib/recommendations/tag-packs.json.
 * Deterministic + owner-editable: the owner can hand-edit the JSON afterwards.
 *
 *   node scripts/generate-tag-packs-from-fit-rules.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ENERGY_TO_VIBE_SLUG = { LOW: "chill-mellow", MEDIUM: "vibe-energy-medium", HIGH: "high-energy" };

function normBusiness(bt) {
  return String(bt).trim().toLowerCase().replace(/_/g, "-");
}
function normDaypart(dp) {
  return String(dp).trim().toLowerCase();
}

async function main() {
  const prisma = new PrismaClient();
  const fitRules = JSON.parse(readFileSync(join(ROOT, "lib/recommendations/fit-rules.json"), "utf8")).rules;

  // Live dictionary: slug -> category (ACTIVE only) so we drop dead/inactive slugs.
  const dict = await prisma.musicTaxonomyTag.findMany({
    where: { status: "ACTIVE" },
    select: { slug: true, category: true },
  });
  const slugCategory = new Map(dict.map((t) => [t.slug, t.category]));
  const has = (slug) => slugCategory.has(slug);

  // Only genres/styles make sensible SEEDS (skip fit-rules rows that are themselves
  // business/daypart slugs like "restaurant"/"morning").
  const SEED_CATEGORIES = new Set(["MAIN_SOUND_GENRE", "STYLE_TAGS"]);

  const packs = [];
  const warnings = [];

  for (const r of fitRules) {
    const seed = r.taxonomyTagSlug;
    const seedCat = slugCategory.get(seed);
    if (!seedCat) {
      warnings.push(`seed "${seed}" not in dictionary — skipped`);
      continue;
    }
    if (!SEED_CATEGORIES.has(seedCat)) continue; // not a genre/style seed

    const related = [];
    const avoid = [];

    for (const bt of r.primaryBusinessTypes ?? []) {
      const s = normBusiness(bt);
      if (has(s)) related.push(s);
    }
    for (const dp of r.daypartFit ?? []) {
      const s = normDaypart(dp);
      if (has(s)) related.push(s);
    }
    const energyBand = (r.energyFit ?? [])[0] ?? null;
    for (const e of r.energyFit ?? []) {
      const s = ENERGY_TO_VIBE_SLUG[e];
      if (s && has(s)) related.push(s);
    }
    for (const bt of r.avoidFor ?? []) {
      const s = normBusiness(bt);
      if (has(s)) avoid.push(s);
    }

    const relatedUnique = [...new Set(related)].filter((s) => s !== seed);
    if (relatedUnique.length === 0) continue;

    packs.push({
      id: `pack-${seed}`,
      seedTagSlugs: [seed],
      relatedTagSlugs: relatedUnique,
      avoidTagSlugs: [...new Set(avoid)],
      suggestEnergyBand: energyBand && ENERGY_TO_VIBE_SLUG[energyBand] ? energyBand : null,
      isActive: true,
      explainHuman: r.explainHuman ?? `Common companions for ${seed}.`,
    });
  }

  await prisma.$disconnect();

  const bundle = {
    version: 1,
    generatedFrom: "fit-rules.json",
    note: "Owner-editable. Regenerate with scripts/generate-tag-packs-from-fit-rules.mjs; hand-edits are preserved only if you don't regenerate over them.",
    packs,
  };

  for (const w of warnings) console.error("WARN:", w);
  console.error(`Generated ${packs.length} packs.`);
  process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
