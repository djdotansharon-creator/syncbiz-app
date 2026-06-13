import { parseDjPlaylistRecipe } from "../lib/dj-intent-parse";

type Case = {
  name: string;
  prompt: string;
  expectMode: "single" | "multi";
  expectLaneCount: number;
  expectGroupLabels?: string[][];
};

const CASES: Case[] = [
  {
    name: "single: ים תיכוני רגוע",
    prompt: "ים תיכוני רגוע",
    expectMode: "single",
    expectLaneCount: 1,
    expectGroupLabels: [["Mediterranean/Mizrahi", "Calm/Easy"]],
  },
  {
    name: "single: ROCK EASY",
    prompt: "ROCK EASY",
    expectMode: "single",
    expectLaneCount: 1,
    expectGroupLabels: [["Rock", "Calm/Easy"]],
  },
  {
    name: "single: 1980 מובחרים",
    prompt: "1980 מובחרים",
    expectMode: "single",
    expectLaneCount: 1,
    expectGroupLabels: [["1980s", "Selected"]],
  },
  {
    name: "single: להיטים ישראלים רגועים",
    prompt: "להיטים ישראלים רגועים",
    expectMode: "single",
    expectLaneCount: 1,
    expectGroupLabels: [["Hits", "Israeli", "Calm/Easy"]],
  },
  {
    name: "multi: newline 3 lanes",
    prompt: "ים תיכוני רגוע\nROCK EASY\n1980 מובחרים",
    expectMode: "multi",
    expectLaneCount: 3,
    expectGroupLabels: [
      ["Mediterranean/Mizrahi", "Calm/Easy"],
      ["Rock", "Calm/Easy"],
      ["1980s", "Selected"],
    ],
  },
  {
    name: "multi: comma 3 lanes",
    prompt: "ים תיכוני רגוע, ROCK EASY, 1980 מובחרים",
    expectMode: "multi",
    expectLaneCount: 3,
    expectGroupLabels: [
      ["Mediterranean/Mizrahi", "Calm/Easy"],
      ["Rock", "Calm/Easy"],
      ["1980s", "Selected"],
    ],
  },
];

const NO_SPLIT = ["ים תיכוני רגוע", "ROCK EASY SELECTED", "להיטים ישראלים רגועים", "rock, pop and soul"];

let failed = 0;

for (const c of CASES) {
  const r = parseDjPlaylistRecipe(c.prompt);
  const okMode = r.mode === c.expectMode;
  const okCount = r.lanes.length === c.expectLaneCount;
  let okLabels = true;
  if (c.expectGroupLabels) {
    okLabels = c.expectGroupLabels.every((expected, i) => {
      const got = r.lanes[i]?.groups.map((g) => g.label) ?? [];
      return expected.every((label) => got.includes(label));
    });
  }
  const ok = okMode && okCount && okLabels;
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}\t${c.name}`);
  console.log(`  mode=${r.mode} lanes=${r.lanes.length} shared=${r.sharedGroupIds?.join(",") ?? "(none)"}`);
  for (const lane of r.lanes) {
    console.log(`    ${lane.id}: ${lane.label} [${lane.groups.map((g) => g.label).join(", ")}] (${lane.parseConfidence})`);
  }
}

console.log("\nShould NOT split (single lane):");
for (const q of NO_SPLIT) {
  const r = parseDjPlaylistRecipe(q);
  const ok = r.mode === "single" && r.lanes.length === 1;
  if (!ok) failed += 1;
  console.log(`  ${ok ? "OK" : "FAIL"}\t${q} → mode=${r.mode} lanes=${r.lanes.length}`);
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}

console.log("\nAll parseDjPlaylistRecipe checks passed.");
