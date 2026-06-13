/**
 * Tests for per-track display metadata resolver + AI-builder derivation.
 *
 * Covers:
 *   - Priority chain in `resolveTrackDisplayMetadata`:
 *     track fields → session cache → parent playlist → "Unclassified" fallback.
 *   - `deriveLocalTrackMetadata` reading ID3 genre / comment tags.
 *   - `deriveCatalogTrackMetadata` mapping taxonomy slugs to genre/mood chips
 *     via the intent dictionary.
 *   - Operator-only `metadataSource` provenance ("local_id3", "catalog", ...).
 *
 * Run: `npx tsx scripts/test-track-meta-chips.ts`
 */

import { resolveTrackDisplayMetadata } from "../lib/playlist-track-display-meta";
import {
  deriveCatalogTrackMetadata,
  deriveLocalTrackMetadata,
} from "../lib/recommendations/derive-track-metadata";
import type { PlaylistTrack } from "../lib/playlist-types";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else {
    console.log("OK", msg);
  }
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  const ok =
    JSON.stringify(actual) === JSON.stringify(expected) || actual === expected;
  if (!ok) {
    console.error("FAIL", msg, `\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  } else {
    console.log("OK", msg);
  }
}

// ---------------------------------------------------------------------------
// resolveTrackDisplayMetadata — priority chain
// ---------------------------------------------------------------------------

const youtubeTrack: PlaylistTrack = {
  id: "yt-1",
  name: "Whatever",
  type: "youtube",
  url: "https://yt/whatever",
};

const localTrack: PlaylistTrack = {
  id: "local-1",
  name: "Local Song",
  type: "local",
  url: "C:\\Music\\Song.mp3",
};

// 1. Track-level fields win over session cache / parent playlist.
{
  const trackWithMeta: PlaylistTrack = {
    ...youtubeTrack,
    genre: "Jazz",
    mood: "Chill",
    metadataSource: "local_id3",
  };
  const meta = resolveTrackDisplayMetadata(trackWithMeta, {
    trackMetaCache: { "yt-1": { genre: "Rock", mood: "Happy" } },
    parentPlaylist: { primaryGenre: "pop", mood: "warm", genre: "Mixed" },
  });
  eq(meta.genreChip, "Jazz", "Track-level genre beats session cache + parent playlist");
  eq(meta.moodChip, "Chill", "Track-level mood beats session cache + parent playlist");
  eq(meta.metadataSource, "local_id3", "Operator metadataSource preserved from track");
  eq(meta.sourceKind, "youtube", "YouTube source kind detected");
}

// 2. Session cache wins over parent playlist when track has no fields.
{
  const meta = resolveTrackDisplayMetadata(youtubeTrack, {
    trackMetaCache: {
      "yt-1": { genre: "Jazz", metadataSource: "catalog" },
    },
    parentPlaylist: { primaryGenre: "pop", genre: "Mixed" },
  });
  eq(meta.genreChip, "Jazz", "Session cache beats parent playlist");
  eq(meta.metadataSource, "catalog", "Session cache provenance preserved");
}

// 3. Parent playlist falls back when track + cache are silent.
{
  const meta = resolveTrackDisplayMetadata(youtubeTrack, {
    parentPlaylist: { primaryGenre: "pop", mood: "warm", subGenres: ["soft-pop"] },
  });
  eq(meta.genreChip, "Pop", "Playlist primaryGenre used + display-prettified");
  eq(meta.moodChip, "Warm", "Playlist mood used + display-prettified");
  eq(meta.subGenreChips[0], "Soft pop", "Playlist subGenre flows through");
  eq(meta.metadataSource, "playlist", "metadataSource = 'playlist' when only playlist fired");
}

// 4. Legacy `playlist.genre` string is used when primaryGenre is absent.
{
  const meta = resolveTrackDisplayMetadata(youtubeTrack, {
    parentPlaylist: { genre: "World" },
  });
  eq(meta.genreChip, "World", "Legacy playlist.genre falls through when primaryGenre missing");
}

// 5. Nothing known → Unclassified fallback, with English + Hebrew locale.
{
  const en = resolveTrackDisplayMetadata(youtubeTrack, { locale: "en" });
  assert(en.genreChip == null, "No genre when nothing is known");
  eq(en.unclassifiedLabel, "Unclassified", "English fallback label");

  const he = resolveTrackDisplayMetadata(youtubeTrack, { locale: "he" });
  eq(he.unclassifiedLabel, "לא סווג", "Hebrew fallback label");
}

// 6. Local tracks get the Local source pill (Hebrew + English).
{
  const en = resolveTrackDisplayMetadata(localTrack, { locale: "en" });
  eq(en.sourceKind, "local", "Local source kind");
  eq(en.sourceLabel, "Local", "Local source label (en)");

  const he = resolveTrackDisplayMetadata(localTrack, { locale: "he" });
  eq(he.sourceLabel, "מקומי", "Local source label (he)");
}

// 7. Catalog-linked YouTube track is shown as 'Catalog', not YouTube.
{
  const catalogTrack: PlaylistTrack = {
    ...youtubeTrack,
    catalogItemId: "cat-1",
  };
  const meta = resolveTrackDisplayMetadata(catalogTrack);
  eq(meta.sourceKind, "catalog", "Catalog-linked track surfaces as Catalog");
}

// 8. SubGenre dedupe + cap at 2.
{
  const meta = resolveTrackDisplayMetadata(
    { ...youtubeTrack, subGenres: ["soft-pop", "soft-pop", "indie-pop", "hard-rock"] },
  );
  eq(meta.subGenreChips.length, 2, "subGenres capped at 2 after dedupe");
  eq(meta.subGenreChips[0], "Soft pop", "first subGenre prettified");
  eq(meta.subGenreChips[1], "Indie pop", "second subGenre prettified");
}

// ---------------------------------------------------------------------------
// deriveLocalTrackMetadata — ID3 genre + PlaylistPro comment tags
// ---------------------------------------------------------------------------

// 9. ID3 genre is taken verbatim; comment "EASY" lifts to mood "Calm".
{
  const out = deriveLocalTrackMetadata({
    genre: "Jazz",
    comment: "EASY",
  });
  eq(out.genre, "Jazz", "ID3 genre flows to chip");
  eq(out.mood, "Calm", "comment=EASY → mood=Calm");
  eq(out.metadataSource, "local_id3", "metadataSource=local_id3");
}

// 10. Comment "HIT" lifts to mood "Hits"; SELECTED adds a subGenre chip.
{
  const out = deriveLocalTrackMetadata({
    genre: null,
    comment: "HIT,SELECTED",
  });
  eq(out.mood, "Hits", "comment=HIT → mood=Hits");
  eq(out.subGenres?.[0], "Selected", "comment=SELECTED → subGenre 'Selected'");
}

// 11. Empty / null fields → no metadata.
{
  const out = deriveLocalTrackMetadata({ genre: null, comment: null });
  eq(Object.keys(out).length, 0, "Empty local fields → empty metadata");
}

// 12. Matched local groups: mood_calm goes to mood; israeli goes to genre.
{
  const out = deriveLocalTrackMetadata({
    genre: null,
    comment: null,
    matchedLocalGroupIds: ["israeli", "mood_calm"],
  });
  eq(out.genre, "Israeli", "israeli group → genre chip (uses dictionary label)");
  eq(out.mood, "Calm/Easy", "mood_calm group → mood chip");
  eq(out.metadataSource, "fallback", "metadataSource=fallback when only group hints fire");
}

// ---------------------------------------------------------------------------
// deriveCatalogTrackMetadata — taxonomy slug → chip mapping
// ---------------------------------------------------------------------------

// 13. Israeli-pop slug → Israeli chip; chill-mellow → Calm/Easy mood.
{
  const out = deriveCatalogTrackMetadata({
    taxonomySlugs: ["israeli-hits", "chill-mellow"],
    matchedSlugsFromIntent: ["israeli-hits"],
  });
  eq(out.genre, "Israeli", "israeli-hits → Israeli genre chip");
  eq(out.mood, "Calm/Easy", "chill-mellow → Calm mood chip");
  eq(out.metadataSource, "catalog", "metadataSource=catalog");
}

// 14. 1980s decade + jazz family → genre takes first slot, decade flows to subGenres.
{
  const out = deriveCatalogTrackMetadata({
    taxonomySlugs: ["jazz", "80s-new-wave-pop"],
  });
  eq(out.genre, "Jazz", "Jazz mapped from 'jazz' slug");
  eq(out.subGenres?.[0], "1980s", "1980s decade flows to subGenre when genre is taken");
}

// 15. Unknown slug → prettified pass-through, still tagged 'catalog'.
{
  const out = deriveCatalogTrackMetadata({
    taxonomySlugs: ["weird-custom-tag"],
  });
  eq(out.genre, "weird-custom-tag", "Unknown slug passes through as-is");
  eq(out.metadataSource, "catalog", "Pass-through still tagged 'catalog'");
}

// 16. Empty slugs → empty metadata.
{
  const out = deriveCatalogTrackMetadata({ taxonomySlugs: [] });
  eq(Object.keys(out).length, 0, "Empty slugs → empty metadata");
}

// ---------------------------------------------------------------------------
// Integration: AI-built track → resolver
// ---------------------------------------------------------------------------

// 17. AI-built catalog track + resolver produces the right chips end-to-end.
{
  const meta = deriveCatalogTrackMetadata({
    taxonomySlugs: ["mediterranean-pop", "chill-mellow"],
  });
  const track: PlaylistTrack = {
    id: "cat-row-9",
    name: "Mizrahi Mellow",
    type: "youtube",
    url: "https://example/cat-row-9",
    catalogItemId: "cat-row-9",
    ...(meta.genre ? { genre: meta.genre } : {}),
    ...(meta.mood ? { mood: meta.mood } : {}),
    ...(meta.metadataSource ? { metadataSource: meta.metadataSource } : {}),
  };
  const resolved = resolveTrackDisplayMetadata(track);
  eq(resolved.genreChip, "Mediterranean/Mizrahi", "Catalog track chip resolves end-to-end");
  eq(resolved.moodChip, "Calm/Easy", "Catalog track mood resolves end-to-end");
  eq(resolved.sourceKind, "catalog", "Catalog-linked YouTube → 'catalog' source pill");
}

if (process.exitCode === 1) {
  console.error("\nTrack meta chips: SOME TESTS FAILED");
} else {
  console.log("\nAll track meta chip checks passed.");
}
