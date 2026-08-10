/**
 * Catalog maintenance (LOCAL dev only) — re-runnable any time junk appears.
 *   1. CLEAN: remove seed/placeholder CatalogItems (fake URLs — e.g. sv000000… "Midnight Avenue").
 *   2. HEALTH: check each real YouTube URL via YouTube oEmbed (200 = alive, 401/404 = removed/private).
 *   3. RE-RESOLVE: for a DEAD url, search YouTube by the track's own title/artist and swap in a live
 *      source; if nothing is found, ARCHIVE it (never leave a dead URL in the catalog).
 *
 * READ-ONLY w.r.t. music files. Never touches production. Run:
 *   DATABASE_URL=postgresql://postgres:…@localhost:5432/syncbiz_dev SYNCBIZ_ENV=development npx tsx scripts/catalog-maintenance.ts
 */
import { PrismaClient } from "@prisma/client";
import { searchYouTubeFast } from "../lib/yt-dlp-search";

const FAKE_URL = /sv0{4,}\d|seedspoti|example\.com|placeholder|@seedchannel/i;
const YT_ID = (u: string) => (u ?? "").match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/)?.[1] ?? "";

function assertLocalDev() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)/.test(url) || !/dev/.test(url)) throw new Error("refuse: not local dev DB");
  if ((process.env.SYNCBIZ_ENV ?? "development") !== "development") throw new Error("refuse: SYNCBIZ_ENV must be development");
}

/** oEmbed availability: 200 = playable, 401/404 = removed/private, null = inconclusive (network). */
async function isYouTubeAlive(videoId: string): Promise<boolean | null> {
  if (!videoId) return null;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`, { method: "GET" });
    if (res.status === 200) return true;
    if (res.status === 401 || res.status === 403 || res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

async function main() {
  assertLocalDev();
  const prisma = new PrismaClient();
  const reresolve = process.argv.includes("--reresolve");
  try {
    // 1) CLEAN seed/placeholder junk.
    const all = await prisma.catalogItem.findMany({ select: { id: true, title: true, url: true, artist: true, archivedAt: true } });
    const fakeIds = all.filter((i) => FAKE_URL.test(i.url ?? "")).map((i) => i.id);
    if (fakeIds.length) await prisma.catalogItem.deleteMany({ where: { id: { in: fakeIds } } });

    // 2) HEALTH-CHECK the remaining real YouTube items.
    const live = all.filter((i) => !fakeIds.includes(i.id) && !i.archivedAt && /youtube\.com|youtu\.be/i.test(i.url ?? ""));
    const dead: { id: string; title: string; artist: string | null }[] = [];
    let alive = 0, inconclusive = 0;
    for (const it of live) {
      const status = await isYouTubeAlive(YT_ID(it.url ?? ""));
      if (status === true) alive++;
      else if (status === false) dead.push({ id: it.id, title: it.title ?? "", artist: it.artist });
      else inconclusive++;
    }

    // 3) RE-RESOLVE dead URLs by the track's identity (only with --reresolve).
    let reresolved = 0, archived = 0;
    if (reresolve) {
      for (const d of dead) {
        const query = [d.artist, d.title].filter(Boolean).join(" ").trim();
        let newUrl = "";
        if (query.length >= 2) {
          try {
            // Pick the first candidate that is actually EMBEDDABLE (oEmbed 200) — a top result that is
            // itself embedding-disabled would just reintroduce a dead-in-player URL.
            const hits = await searchYouTubeFast(query, 6);
            for (const h of hits) {
              const id = h.id || YT_ID(h.url ?? "");
              if (!id) continue;
              if ((await isYouTubeAlive(id)) === true) {
                newUrl = h.url || `https://www.youtube.com/watch?v=${id}`;
                break;
              }
            }
          } catch { /* leave for archive */ }
        }
        if (newUrl) {
          await prisma.catalogItem.update({ where: { id: d.id }, data: { url: newUrl, canonicalUrl: newUrl } });
          reresolved++;
        } else {
          await prisma.catalogItem.update({ where: { id: d.id }, data: { archivedAt: new Date(), archiveReason: "dead_url_no_replacement" } });
          archived++;
        }
      }
    }

    console.log(JSON.stringify({
      cleanedFakes: fakeIds.length,
      checkedLive: live.length,
      alive, dead: dead.length, inconclusive,
      reresolveMode: reresolve,
      reresolved, archivedDead: archived,
      deadSample: dead.slice(0, 8).map((d) => `${d.artist ?? ""} — ${d.title}`.trim()),
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
