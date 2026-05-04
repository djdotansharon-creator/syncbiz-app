/**
 * Stage 7.1 — console / JSON coverage health for Music Programming packs.
 * Read-only Prisma. Usage: npx tsx scripts/report-catalog-coverage.ts [--json]
 */

import { readFileSync } from "fs";
import { resolve } from "path";

import { prisma } from "../lib/prisma";
import {
  formatCoverageHealthConsole,
  generateCatalogCoverageHealthReport,
} from "../lib/recommendations/catalog-coverage-health";
import { parseCatalogCoverageTargetsBundle } from "../lib/recommendations/catalog-coverage-targets.types";

async function main() {
  const jsonPath = resolve(process.cwd(), "lib/recommendations/catalog-coverage-targets.json");
  const raw: unknown = JSON.parse(readFileSync(jsonPath, "utf8"));
  const parsed = parseCatalogCoverageTargetsBundle(raw);
  if (!parsed.success) {
    console.error(parsed.error.flatten());
    process.exit(1);
  }

  const items = await prisma.catalogItem.findMany({
    where: { archivedAt: null },
    select: {
      url: true,
      provider: true,
      durationSec: true,
      thumbnail: true,
      manualEnergyRating: true,
      archivedAt: true,
      taxonomyLinks: {
        select: {
          taxonomyTag: { select: { slug: true } },
        },
      },
    },
  });

  const report = generateCatalogCoverageHealthReport(parsed.data, items);

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatCoverageHealthConsole(report)}\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
