import { validateDjIntentDictionaryTaxonomySlugs } from "../lib/dj-intent-taxonomy-validation";

const result = validateDjIntentDictionaryTaxonomySlugs();

console.log("DJ Intent Dictionary taxonomy validation");
console.log("Referenced slug references:", result.referencedCount);
console.log("OK:", result.ok);

if (result.missingSlugs.length > 0) {
  console.error("Missing slugs:", result.missingSlugs.join(", "));
  process.exit(1);
}

console.log("All taxonomy slugs exist in seed JSON.");
