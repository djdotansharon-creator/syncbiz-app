/**
 * YouTube Charts → SyncBiz catalog (LOCAL dev only). Re-runnable.
 *
 * For each genre, pull the TOP-VIEWED music from YouTube (already view-sorted by the fast search) and
 * upsert it into the catalog as `CatalogItem` + a `CatalogSourceSnapshot` carrying the real `viewCount`.
 * smart-catalog-search ranks by `popBoost(viewCount)`, so this makes the DJ Creator's catalog tier (①)
 * surface the MOST-PLAYED tracks per genre — the owner's "most YouTube plays" requirement.
 *
 * READ-ONLY w.r.t. music files. Never touches production. Run:
 *   DATABASE_URL=postgresql://…@localhost:5432/syncbiz_dev SYNCBIZ_ENV=development npx tsx scripts/ingest-youtube-charts.ts
 */
import { PrismaClient } from "@prisma/client";
import { searchYouTubeFast } from "../lib/yt-dlp-search";

// A spread across the owner's real use-cases: contemporary + restaurant/lounge + retro/bank genres.
const GENRES = [
  "afro house", "deep house", "house music", "pop hits", "hip hop",
  "bossa nova", "jazz", "lounge music", "soul music",
  "80s hits", "90s hits", "70s disco", "blues",
];
const PER_GENRE = 15;

const YT_ID = (u: string) => (u ?? "").match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/)?.[1] ?? "";

function assertLocalDev() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)/.test(url) || !/dev/.test(url)) throw new Error("refuse: not local dev DB");
  if ((process.env.SYNCBIZ_ENV ?? "development") !== "development") throw new Error("refuse: SYNCBIZ_ENV must be development");
}

function splitArtistTitle(raw: string): { artist: string | null; title: string } {
  const t = (raw ?? "").trim();
  const i = t.indexOf(" - ");
  if (i > 0) return { artist: t.slice(0, i).trim(), title: t.slice(i + 3).trim() };
  return { artist: null, title: t };
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// smart-catalog-search only scans items that HAVE a taxonomy tag, so every ingested chart track must be
// linked to a MAIN_SOUND_GENRE tag (find-or-create per genre).
async function genreTagId(prisma: PrismaClient, genre: string): Promise<string> {
  const slug = slugify(genre);
  const existing = await prisma.musicTaxonomyTag.findUnique({ where: { slug }, select: { id: true } });
  if (existing) return existing.id;
  const tag = await prisma.musicTaxonomyTag.create({
    data: { slug, category: "MAIN_SOUND_GENRE", labelEn: genre, labelHe: genre, aliases: [genre, slug] },
  });
  return tag.id;
}

async function main() {
  assertLocalDev();
  const prisma = new PrismaClient();
  try {
    let created = 0, updated = 0, snapshots = 0, skipped = 0, linked = 0;
    for (const genre of GENRES) {
      const tagId = await genreTagId(prisma, genre);
      const query = `${genre} ${new Date().getFullYear()}`.trim();
      let hits: Awaited<ReturnType<typeof searchYouTubeFast>> = [];
      try { hits = await searchYouTubeFast(query, PER_GENRE); } catch { hits = []; }
      for (const h of hits) {
        const videoId = (h.id ?? YT_ID(h.url ?? "")).trim();
        const url = (h.url ?? (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "")).trim();
        if (!videoId || !/^https?:\/\//i.test(url) || !h.title) { skipped++; continue; }
        const { artist, title } = splitArtistTitle(h.title);
        const durationSec = h.duration ? Math.round(h.duration) : null;

        const existing = await prisma.catalogItem.findUnique({ where: { url }, select: { id: true, genres: true } });
        let itemId: string;
        if (existing) {
          const genres = [...new Set([...(existing.genres ?? []), genre])];
          await prisma.catalogItem.update({ where: { id: existing.id }, data: { title, artist, videoId, provider: "youtube", thumbnail: h.cover ?? null, durationSec, genres } });
          itemId = existing.id; updated++;
        } else {
          const item = await prisma.catalogItem.create({ data: { url, canonicalUrl: url, videoId, provider: "youtube", title, artist, thumbnail: h.cover ?? null, durationSec, genres: [genre] } });
          itemId = item.id; created++;
        }

        // Link to the genre taxonomy tag so smart-catalog-search will scan + rank it.
        const linkExists = await prisma.catalogItemTaxonomyTag.findFirst({ where: { catalogItemId: itemId, taxonomyTagId: tagId }, select: { id: true } });
        if (!linkExists) { await prisma.catalogItemTaxonomyTag.create({ data: { catalogItemId: itemId, taxonomyTagId: tagId } }); linked++; }

        // Refresh the popularity snapshot (smart-search reads the newest one for popBoost).
        await prisma.catalogSourceSnapshot.deleteMany({ where: { catalogItemId: itemId } });
        await prisma.catalogSourceSnapshot.create({
          data: {
            catalogItemId: itemId, provider: "youtube", sourceUrl: url,
            fetchStatus: "SUCCESS", fetchMethod: "YTDLP",
            title, viewCount: h.view_count ?? null, likeCount: null, durationSec, thumbnail: h.cover ?? null,
          },
        });
        snapshots++;
      }
      console.log(`  ${genre}: ${hits.length} hits`);
    }
    console.log(JSON.stringify({ genres: GENRES.length, created, updated, snapshots, linked, skipped }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
