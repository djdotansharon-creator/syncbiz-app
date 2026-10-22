// READ-ONLY verification of the shufersal apply. Run via `railway run -s Postgres`.
import { PrismaClient } from "@prisma/client";
if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
const p = new PrismaClient();
try {
  const totalMA = await p.mediaAsset.count();
  const totalLAS = await p.logicalAssetSource.count();
  const shufMA = await p.mediaAsset.count({ where: { genreId: "shufersal-demo" } });
  const shufReady = await p.mediaAsset.count({ where: { genreId: "shufersal-demo", status: "READY" } });
  const shufLAS = await p.logicalAssetSource.count({ where: { source: "r2-shufersal-demo" } });
  const existingOtherMA = totalMA - shufMA;
  const byGenre = (await p.mediaAsset.groupBy({ by: ["genreId"], _count: { _all: true } }))
    .map((g) => ({ g: g.genreId, n: g._count._all }))
    .sort((a, b) => ("" + a.g).localeCompare("" + b.g));
  // a few sample shufersal rows (public fields only)
  const sample = await p.mediaAsset.findMany({ where: { genreId: "shufersal-demo" }, select: { logicalId: true, objectKey: true, status: true, durationSeconds: true }, take: 3 });
  console.log(JSON.stringify({ totalMA, totalLAS, shufMA, shufReady, shufLAS, existingOtherMA, byGenre, sample }, null, 1));
} finally {
  await p.$disconnect();
}
