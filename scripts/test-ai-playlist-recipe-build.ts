import { parseDjPlaylistRecipe } from "../lib/dj-intent-parse";
import {
  allocateLaneQuotas,
  interleaveLanePicks,
  type RecipeLanePick,
} from "../lib/ai-playlist-recipe-build-utils";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else {
    console.log("OK", msg);
  }
}

assert(JSON.stringify(allocateLaneQuotas(50, 3)) === JSON.stringify([17, 17, 16]), "50/3 → 17/17/16");
assert(JSON.stringify(allocateLaneQuotas(25, 3)) === JSON.stringify([9, 8, 8]), "25/3 → 9/8/8");
assert(JSON.stringify(allocateLaneQuotas(10, 1)) === JSON.stringify([10]), "10/1 → 10");

const lanePicks: RecipeLanePick[][] = [
  [
    { kind: "catalog", row: { catalogItemId: "l1a", displayScore: 10 } },
    { kind: "catalog", row: { catalogItemId: "l1b", displayScore: 9 } },
  ],
  [
    { kind: "catalog", row: { catalogItemId: "l2a", displayScore: 8 } },
    { kind: "local", candidate: { localId: "loc1", score: 7 } },
  ],
  [{ kind: "catalog", row: { catalogItemId: "l3a", displayScore: 6 } }],
];

const interleaved = interleaveLanePicks(lanePicks, 6);
const interleavedIds = interleaved.map((p) =>
  p.kind === "catalog" ? p.row.catalogItemId : p.candidate.localId,
);
assert(
  JSON.stringify(interleavedIds) === JSON.stringify(["l1a", "l2a", "l3a", "l1b", "loc1"]),
  "interleave lane1,lane2,lane3 round-robin",
);

const single = parseDjPlaylistRecipe("ים תיכוני רגוע");
assert(single.mode === "single" && single.lanes.length === 1, "single prompt stays single");

const multiNl = parseDjPlaylistRecipe("ים תיכוני רגוע\nROCK EASY\n1980 מובחרים");
assert(multiNl.mode === "multi" && multiNl.lanes.length === 3, "newline → 3 lanes");

const multiComma = parseDjPlaylistRecipe("ים תיכוני רגוע, ROCK EASY, 1980 מובחרים");
assert(multiComma.mode === "multi" && multiComma.lanes.length === 3, "comma → 3 lanes");

if (process.exitCode === 1) {
  console.error("\nSome recipe build helper checks failed.");
  process.exit(1);
}

console.log("\nAll ai-playlist recipe build helper checks passed.");
