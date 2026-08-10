/**
 * Bridge + resolve SELECTED bank tracks so the DJ Creator "your bank" tier can serve them (LOCAL dev).
 *
 *   Bridge   — LocalTrackFile → UniversalTrack + a `local` ProviderMapping (physical playback on the
 *              bank machine). Instant, exact, uses only DB metadata; NEVER touches a music file.
 *   Resolve  — search YouTube by the track's own artist/title and attach a PLAYABLE, EMBEDDABLE
 *              `youtube` ProviderMapping (so the track also plays in a browser / remote client).
 *
 * Filter by a genre substring (all tokens must appear in one of the track's genres) + limit. e.g.:
 *   … npx tsx scripts/ingest-bank-selected.ts "1980 easy" 60
 * READ-ONLY w.r.t. music files. Never touches production.
 */
import { PrismaClient } from "@prisma/client";
import { searchYouTubeFast } from "../lib/yt-dlp-search";
import { ensureUniversalTrackId } from "../lib/universal/ensure-universal-track";

const isSel = (a: string[]) => (a ?? []).some((c) => /\bselect(ed|es|e)?\b/i.test(c ?? ""));

function assertLocalDev() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)/.test(url) || !/dev/.test(url)) throw new Error("refuse: not local dev DB");
  if ((process.env.SYNCBIZ_ENV ?? "development") !== "development") throw new Error("refuse: SYNCBIZ_ENV must be development");
}

async function isYouTubeAlive(id: string): Promise<boolean | null> {
  if (!id) return null;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
    if (r.status === 200) return true;
    if ([401, 403, 404].includes(r.status)) return false;
    return null;
  } catch { return null; }
}

async function main() {
  assertLocalDev();
  const filterTokens = (process.argv[2] ?? "1980 easy").toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Number(process.argv[3] ?? 60);
  const prisma = new PrismaClient();
  try {
    const files = await prisma.localTrackFile.findMany({
      where: { availability: "available" },
      select: { id: true, sourceId: true, localRef: true, originalTitle: true, originalArtists: true, originalGenres: true, originalComments: true, universalTrackId: true },
    });
    const targets = files.filter((f) => {
      if (!isSel(f.originalComments)) return false;
      const hay = (f.originalGenres ?? []).join(" | ").toLowerCase();
      return filterTokens.every((t) => hay.includes(t));
    }).slice(0, limit);

    let bridged = 0, ytResolved = 0, ytFailed = 0;
    for (const f of targets) {
      const title = (f.originalTitle ?? "").trim();
      const artist = (f.originalArtists?.[0] ?? "").trim();
      if (!title) continue;

      // 1) BRIDGE — UniversalTrack + local mapping.
      let utid = f.universalTrackId;
      if (!utid) {
        // Single identity path — reuse ONLY on strong id (local provider+localRef / ISRC), else new Recording.
        utid = (await ensureUniversalTrackId(prisma, { provider: "local", externalId: f.localRef, title })).universalTrackId;
        await prisma.localTrackFile.update({ where: { id: f.id }, data: { universalTrackId: utid } });
      }
      await prisma.providerMapping.upsert({
        where: { provider_externalId: { provider: "local", externalId: f.localRef } },
        create: { provider: "local", externalId: f.localRef, universalTrackId: utid, playableStatus: "PLAYABLE", matchMethod: "local_bank", matchConfidence: 1 },
        update: { universalTrackId: utid, playableStatus: "PLAYABLE" },
      });
      bridged++;

      // 2) RESOLVE — an embeddable YouTube mapping (skip if one already exists).
      const hasYt = await prisma.providerMapping.findFirst({ where: { universalTrackId: utid, provider: "youtube", playableStatus: "PLAYABLE" } });
      if (hasYt) { ytResolved++; continue; }
      let done = false;
      try {
        const hits = await searchYouTubeFast([artist, title].filter(Boolean).join(" "), 6);
        for (const h of hits) {
          const id = h.id ?? "";
          if (!id) continue;
          if ((await isYouTubeAlive(id)) !== true) continue;
          await prisma.providerMapping.upsert({
            where: { provider_externalId: { provider: "youtube", externalId: id } },
            create: { provider: "youtube", externalId: id, externalUrl: h.url || `https://www.youtube.com/watch?v=${id}`, universalTrackId: utid, playableStatus: "PLAYABLE", matchMethod: "bank_resolve", matchConfidence: 0.7, lastVerifiedAt: new Date() },
            update: { externalUrl: h.url || `https://www.youtube.com/watch?v=${id}`, playableStatus: "PLAYABLE", lastVerifiedAt: new Date() },
          });
          done = true; ytResolved++; break;
        }
      } catch { /* leave unresolved */ }
      if (!done) ytFailed++;
    }
    console.log(JSON.stringify({ filter: filterTokens.join(" "), targets: targets.length, bridged, ytResolved, ytFailed }, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
