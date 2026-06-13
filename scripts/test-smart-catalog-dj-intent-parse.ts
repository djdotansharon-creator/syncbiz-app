import { parseSmartCatalogQuery } from "../lib/recommendations/parse-smart-catalog-query";

const QUERIES = [
  "ישראלי רגוע",
  "ים תיכוני רגוע",
  "להיטים ישראלים",
  "1980 מובחרים",
  "ROCK EASY",
  "מסעדה רגוע",
  "לובי יוקרתי",
];

for (const q of QUERIES) {
  const p = parseSmartCatalogQuery(q);
  console.log(`\nQUERY: ${q}`);
  console.log("  slugs:", p.styleTaxonomySlugs.sort().join(", ") || "(none)");
  console.log("  moods:", p.moodHints.join(", ") || "(none)");
  console.log("  energy:", p.energyHint ?? "(none)");
  console.log("  business:", p.businessType ?? "(none)");
  console.log("  matched:", p.matchedPhrases.slice(0, 8).join(" | "));
}
