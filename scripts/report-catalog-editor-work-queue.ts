/**
 * Stage 7.2 — editor-facing work queue from coverage packs (read-only).
 * Usage: npx tsx scripts/report-catalog-editor-work-queue.ts [--json]
 */

import { readFileSync } from "fs";
import { resolve } from "path";

import { prisma } from "../lib/prisma";
import {
  formatEditorWorkQueueConsole,
  generateCatalogEditorWorkQueueReport,
} from "../lib/recommendations/catalog-coverage-work-queue";
import { parseCatalogCoverageTargetsBundle } from "../lib/recommendations/catalog-coverage-targets.types";

async function main() {
  const jsonPath = resolve(process.cwd(), "lib/recommendations/catalog-coverage-targets.json");
  const raw: unknown = JSON.parse(readFileSync(jsonPath, "utf8"));
  const parsed = parseCatalogCoverageTargetsBundle(raw);
  if (!parsed.success) {
    console.error(parsed.error);
    process.exit(1);
  }

  const items = await prisma.catalogItem.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      title: true,
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

  const report = generateCatalogEditorWorkQueueReport(parsed.data, items);

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatEditorWorkQueueConsole(report)}\n`);
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
