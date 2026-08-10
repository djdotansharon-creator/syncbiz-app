/**
 * LOCAL tests for the Local Library bridge + PlaybackSourceResolver. Guarded to local.
 * Creates isolated test data (deviceId "zztest-device", titles "ZZTEST…") and cleans up.
 */

import { PrismaClient } from "@prisma/client";
import { assertSafeIngestionTarget } from "@/lib/universal/ingestion-env-guard";
import { syncLocalTrackFile, type LocalTrackSyncPayload } from "@/lib/universal/local-library-bridge";
import { DbPlaybackSourceResolver } from "@/lib/universal/playback-source-resolver";
import type { YouTubeSearchResult } from "@/lib/search-service";

const DEVICE = "zztest-device";
let passed = 0, failed = 0;
const check = (name: string, cond: boolean) => { if (cond) passed++; else { failed++; console.error(`  ✗ ${name}`); } };

async function cleanup(prisma: PrismaClient) {
  await prisma.localLibrarySource.deleteMany({ where: { deviceId: DEVICE } });
  await prisma.universalTrack.deleteMany({ where: { displayTitle: { startsWith: "ZZTEST" } } });
}

function payload(localRef: string, over: Partial<LocalTrackSyncPayload> = {}): LocalTrackSyncPayload {
  return { deviceId: DEVICE, localRef, filename: "song.mp3", fileSize: 1000, metadataHash: "h1", durationMs: 200000, metadata: { title: "ZZTEST Song" }, ...over };
}

async function main() {
  assertSafeIngestionTarget("local library sync test");
  const prisma = new PrismaClient();
  try {
    await cleanup(prisma);

    // 1. create
    const r1 = await syncLocalTrackFile(prisma, payload("loc_zztest01", { metadata: { title: "ZZTEST Alpha", isrc: "USABC1111111" } }), { apply: true });
    check("create → action=created + ut", r1.action === "created" && !!r1.universalTrackId);
    const ut1 = r1.universalTrackId!;
    const utRow = await prisma.universalTrack.findUnique({ where: { id: ut1 }, select: { canonicalIsrc: true } });
    check("ISRC present → stored", utRow?.canonicalIsrc === "USABC1111111");
    const localMap = await prisma.providerMapping.findFirst({ where: { universalTrackId: ut1, provider: "local" }, select: { externalId: true, matchMethod: true } });
    check("local ProviderMapping created", localMap?.externalId === "loc_zztest01" && localMap?.matchMethod === "local_file");

    // 2. unchanged (same hash) → idempotent
    const r2 = await syncLocalTrackFile(prisma, payload("loc_zztest01", { metadata: { title: "ZZTEST Alpha", isrc: "USABC1111111" } }), { apply: true });
    check("re-sync same hash → unchanged", r2.action === "unchanged");

    // 3. genre change (hash differs) → updated
    const r3 = await syncLocalTrackFile(prisma, payload("loc_zztest01", { metadataHash: "h2", metadata: { title: "ZZTEST Alpha", isrc: "USABC1111111", genres: ["House"] } }), { apply: true });
    check("genre change (new hash) → updated", r3.action === "updated");

    // 4. comment-only change → updated
    const r4 = await syncLocalTrackFile(prisma, payload("loc_zztest01", { metadataHash: "h3", metadata: { title: "ZZTEST Alpha", isrc: "USABC1111111", comment: "great" } }), { apply: true });
    check("comment change → updated", r4.action === "updated");

    // 5. manual metadata NOT overwritten by mp3
    await prisma.universalTrack.update({ where: { id: ut1 }, data: { canonicalIsrc: "MANUAL999999", metadataProvenance: { isrc: "manual", title: "mp3" } } });
    const r5 = await syncLocalTrackFile(prisma, payload("loc_zztest01", { metadataHash: "h4", metadata: { title: "ZZTEST Alpha", isrc: "USABC2222222" } }), { apply: true });
    const utAfter = await prisma.universalTrack.findUnique({ where: { id: ut1 }, select: { canonicalIsrc: true } });
    check("manual ISRC preserved over mp3 re-scan", utAfter?.canonicalIsrc === "MANUAL999999" && !r5.changedFields.includes("isrc"));

    // 6. no tags → title from filename
    const r6 = await syncLocalTrackFile(prisma, payload("loc_zztest02", { filename: "ZZTEST-untagged.mp3", metadata: {} }), { apply: true });
    const ut6 = await prisma.universalTrack.findUnique({ where: { id: r6.universalTrackId! }, select: { displayTitle: true } });
    check("no tags → title from filename", ut6?.displayTitle === "ZZTEST-untagged");

    // 7. missing → status missing, UT kept
    const r7 = await syncLocalTrackFile(prisma, payload("loc_zztest01", { availability: "missing" }), { apply: true });
    const stillThere = await prisma.universalTrack.findUnique({ where: { id: ut1 }, select: { id: true } });
    const fileRow = await prisma.localTrackFile.findFirst({ where: { localRef: "loc_zztest01" }, select: { status: true } });
    check("vanished → missing, UT not deleted", r7.action === "missing" && !!stillThere && fileRow?.status === "missing");

    // 8. returns → back to available (new scan)
    const r8 = await syncLocalTrackFile(prisma, payload("loc_zztest01", { metadataHash: "h5", metadata: { title: "ZZTEST Alpha" } }), { apply: true });
    const fileBack = await prisma.localTrackFile.findFirst({ where: { localRef: "loc_zztest01" }, select: { status: true } });
    check("returned file → available again", r8.action === "updated" && fileBack?.status === "available");

    // 9. privacy: absolute path localRef rejected
    let threw = false;
    try { await syncLocalTrackFile(prisma, payload("D:\\Music\\x.mp3"), { apply: true }); } catch { threw = true; }
    check("absolute-path localRef rejected", threw);

    // ── PlaybackSourceResolver ──
    const ytProvider = async (_q: string, row: { title?: string }): Promise<YouTubeSearchResult[]> => {
      if ((row.title ?? "").includes("Beta")) {
        return [
          { title: "ZZTEST Beta (Official Audio)", url: "https://www.youtube.com/watch?v=ytzztestB01", cover: null, type: "youtube", viewCount: 5000, durationSeconds: 200 },
          { title: "ZZTEST Beta (Live)", url: "https://www.youtube.com/watch?v=ytzztestLIV", cover: null, type: "youtube", viewCount: 9000, durationSeconds: 240 },
        ];
      }
      return [];
    };
    const scProvider = async (_q: string, row: { title?: string }) => (row.title ?? "").includes("Gamma")
      ? [{ title: "ZZTEST Gamma", url: "https://soundcloud.com/x/zztest-gamma" }, { title: "ZZTEST Gamma (Karaoke)", url: "https://soundcloud.com/x/zztest-gamma-kar" }]
      : [];
    const resolver = new DbPlaybackSourceResolver(prisma, { youtubeCandidateProvider: ytProvider, soundcloudCandidateProvider: scProvider });

    // local present → chosen local (priority)
    const p1 = await resolver.resolvePlayback(ut1);
    check("existing local → chosen local", p1.status === "resolved" && p1.chosen?.provider === "local");

    // no mapping + youtube-safe → provider_resolved youtube (Live rejected)
    const utB = await prisma.universalTrack.create({ data: { displayTitle: "ZZTEST Beta", normalizedTitle: "zztest beta" }, select: { id: true } });
    const p2 = await resolver.resolvePlayback(utB.id, { apply: true, row: { title: "ZZTEST Beta", durationSec: 200 } });
    check("youtube safe → provider_resolved (Live rejected)", p2.status === "provider_resolved" && p2.chosen?.provider === "youtube" && p2.chosen?.externalId === "ytzztestB01");

    // no youtube + soundcloud-safe → provider_resolved soundcloud (Karaoke rejected)
    const utG = await prisma.universalTrack.create({ data: { displayTitle: "ZZTEST Gamma", normalizedTitle: "zztest gamma" }, select: { id: true } });
    const p3 = await resolver.resolvePlayback(utG.id, { apply: true, row: { title: "ZZTEST Gamma" } });
    check("soundcloud fallback → provider_resolved (Karaoke rejected)", p3.status === "provider_resolved" && p3.chosen?.provider === "soundcloud" && !p3.chosen?.externalId.includes("kar"));

    // nothing safe → unresolved
    const utU = await prisma.universalTrack.create({ data: { displayTitle: "ZZTEST Delta", normalizedTitle: "zztest delta" }, select: { id: true } });
    const p4 = await resolver.resolvePlayback(utU.id, { apply: true, row: { title: "ZZTEST Delta" } });
    check("no candidates → unresolved", p4.status === "unresolved" && p4.chosen === null);

    // preference order local>youtube
    await prisma.providerMapping.create({ data: { universalTrackId: utB.id, provider: "local", externalId: "loc_zztestBeta", playableStatus: "PLAYABLE", matchMethod: "local_file" } });
    const p5 = await resolver.resolvePlayback(utB.id);
    check("local beats youtube in preference", p5.chosen?.provider === "local");

    await cleanup(prisma);
    console.log(`\n[check-local-library-sync] ${passed} passed, ${failed} failed`);
    process.exitCode = failed > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
