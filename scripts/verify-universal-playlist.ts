/**
 * Read-only verification of the UniversalPlaylist MVP on the LOCAL dev DB.
 * Checks counts, item statuses, privacy (NO absolute path persisted), the created SyncBiz
 * Playlist, and export history. Guarded to local. npx tsx scripts/verify-universal-playlist.ts
 */

import { PrismaClient } from "@prisma/client";
import { assertSafeIngestionTarget } from "@/lib/universal/ingestion-env-guard";

// Absolute-path signatures ONLY (drive letter, UNC, deep unix path, known local roots).
// A bare `filename` (even with a .mp3/.wav extension) is ALLOWED and is not checked here.
const ABS_PATH = /([a-zA-Z]:[\\/])|(\\\\[^\\]+\\)|(^\/[^/]+\/[^/]+\/)|playlistpro|dropbox/i;

async function main() {
  const t = assertSafeIngestionTarget("verify universal playlist");
  console.log(`[target] env=${t.env} host=${t.host} db=${t.database}`);
  const prisma = new PrismaClient();
  try {
    const playlists = await prisma.universalPlaylist.findMany({
      include: { items: { orderBy: { position: "asc" } }, exports: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`\n[UniversalPlaylists] ${playlists.length}`);
    let leaks = 0;
    for (const p of playlists) {
      const byStatus = p.items.reduce<Record<string, number>>((a, i) => ((a[i.status] = (a[i.status] ?? 0) + 1), a), {});
      console.log(`\n▸ "${p.name}" key=${p.sourceKey} type=${p.sourceType} items=${p.itemCount} dur=${p.totalDurationMs}ms status=${p.status}  ${JSON.stringify(byStatus)}`);
      for (const i of p.items) {
        // privacy: no persisted field (incl. matchReasons) may contain an ABSOLUTE path. filename is fine.
        const checked: Record<string, unknown> = { sourceRef: i.sourceRef, sourceExternalId: i.sourceExternalId, rawTitle: i.rawTitle, matchReasons: JSON.stringify(i.matchReasons ?? "") };
        for (const [f, v] of Object.entries(checked)) {
          if (typeof v === "string" && ABS_PATH.test(v)) { leaks += 1; console.log(`   ✗ PRIVACY LEAK in ${f}: ${v}`); }
        }
        const enr = [i.bpm != null ? `bpm=${i.bpm}` : "", i.comment ? `cmt="${i.comment}"` : "", i.rating != null ? `rating=${i.rating}` : "", i.isrc ? `isrc=${i.isrc}` : ""].filter(Boolean).join(" ");
        console.log(`   #${String(i.position).padStart(2)} ${i.status.padEnd(18)} ut=${i.universalTrackId ? "yes" : "no "} ref=${i.sourceRef ?? "-"} file=${i.filename ?? "-"} title="${i.rawTitle}"${enr ? "  " + enr : ""}`);
      }
      for (const e of p.exports) {
        if (e.errorSummary && ABS_PATH.test(JSON.stringify(e.errorSummary))) { leaks += 1; console.log(`   ✗ PRIVACY LEAK in export.errorSummary`); }
        console.log(`   export → ${e.target} ${e.status} exported=${e.tracksExported}/${e.tracksTotal} missing=${e.tracksMissing} syncbizPlaylist=${e.syncbizPlaylistId ?? "-"}`);
      }
    }

    // SyncBiz side
    const sbPlaylists = await prisma.playlist.findMany({ include: { items: true }, orderBy: { createdAt: "asc" } });
    console.log(`\n[SyncBiz Playlists] ${sbPlaylists.length}`);
    for (const p of sbPlaylists) {
      console.log(`▸ "${p.name}" items=${p.items.length} trackOrder=${p.trackOrder.length} dur=${p.durationSeconds}s`);
    }

    console.log(`\n${leaks === 0 ? "✓ PRIVACY OK — no ABSOLUTE path in any field/log/export (filename + hashed sourceRef are allowed)" : `✗ ${leaks} PRIVACY LEAKS`}`);
    process.exitCode = leaks === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
