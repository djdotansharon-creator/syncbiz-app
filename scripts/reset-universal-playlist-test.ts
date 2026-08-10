/**
 * Reset LOCAL UniversalPlaylist test data (keeps the seed catalog + backfill). Guarded to local.
 * Deletes UniversalPlaylist (cascade items/exports) + Playlists in the validation workspace.
 */
import { PrismaClient } from "@prisma/client";
import { assertSafeIngestionTarget } from "@/lib/universal/ingestion-env-guard";

async function main() {
  assertSafeIngestionTarget("reset universal playlist test data");
  const prisma = new PrismaClient();
  try {
    const up = await prisma.universalPlaylist.deleteMany({});
    const ws = await prisma.workspace.findFirst({ where: { slug: "universal-validation" }, select: { id: true } });
    let pl = 0;
    if (ws) pl = (await prisma.playlist.deleteMany({ where: { workspaceId: ws.id } })).count;
    console.log(`[reset] universalPlaylists=${up.count} validationPlaylists=${pl}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
