import { parseSmartCatalogQuery } from "../lib/recommendations/parse-smart-catalog-query";

function hasSeaConcept(q: string): boolean {
  const p = parseSmartCatalogQuery(q);
  return p.conceptTags.some((t) => t === "beach" || t === "sea" || t === "coast");
}

const SHOULD_NOT: string[] = ["1980 מובחרים", "להיטים ישראלים", "שירים רגועים", "ים תיכוני רגוע"];
const SHOULD: string[] = ["ים", "ליד הים", "מוזיקת ים", "מוזיקה ליד הים", "beach lounge", "beach", "sea", "חוף"];

let failed = 0;

console.log("Should NOT trigger sea/beach:");
for (const q of SHOULD_NOT) {
  const got = hasSeaConcept(q);
  const ok = !got;
  if (!ok) failed += 1;
  console.log(`  ${ok ? "OK" : "FAIL"}\t${q}\tconcepts=${parseSmartCatalogQuery(q).conceptTags.join(",") || "(none)"}`);
}

console.log("\nShould trigger sea/beach:");
for (const q of SHOULD) {
  const got = hasSeaConcept(q);
  const ok = got;
  if (!ok) failed += 1;
  console.log(`  ${ok ? "OK" : "FAIL"}\t${q}\tconcepts=${parseSmartCatalogQuery(q).conceptTags.join(",") || "(none)"}`);
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}

console.log("\nAll sea/beach phrase checks passed.");
