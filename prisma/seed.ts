/**
 * Prisma seed entry — Stage 3 Music Taxonomy Dictionary (platform vocabulary).
 *
 * Safe to run repeatedly (`upsert` by slug); optional JSON layer via
 * `MUSIC_TAXONOMY_SEED_JSON` or `prisma/seed-data/music-taxonomy.generated.json`.
 *
 * @see docs/MUSIC-TAXONOMY-STAGE3.md
 */
import { runMusicTaxonomySeed } from "@/lib/music-taxonomy-seed-runner";

async function main() {
  const r = await runMusicTaxonomySeed();
  console.info(
    `Music taxonomy seed completed. Upserted ${r.upserted}; Stage3 default duplicate merges ${r.defaultDuplicatePairsMerged}; Playlist Pro alias merges applied ${r.playlistProAliasesMerged}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
