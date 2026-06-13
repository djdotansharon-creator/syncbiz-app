import { parseLocalSearchIntents } from "../lib/local-ai-playlist-search";
import {
  catalogRowMatchesParserSlugs,
  isSubstantiveMultiIntentQuery,
  rankCatalogRowsForAiIntents,
  scoreCatalogRowForAiIntents,
  splitCatalogPoolByIntentMatch,
  splitCatalogPoolByParserSlugOverlap,
} from "../lib/recommendations/ai-playlist-intent-match";
import { parseSmartCatalogQuery } from "../lib/recommendations/parse-smart-catalog-query";
import {
  buildDeterministicAiPlaylistCover,
  pickAiPlaylistThumbnail,
} from "../lib/recommendations/ai-playlist-cover";
import {
  applyLocalStrictFloor,
  evaluateLocalStrictFloor,
  getTrustedFolderLabelsForParserSlugs,
} from "../lib/recommendations/local-strict-floor";
import {
  buildSiblingExclusionBundle,
  catalogRowMatchesExcludedSibling,
  localCandidateMatchesExcludedSibling,
} from "../lib/recommendations/sibling-exclusion";
import type { SmartCatalogSearchResultRow } from "../lib/recommendations/smart-catalog-search";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else {
    console.log("OK", msg);
  }
}

function mockRow(
  id: string,
  title: string,
  slugs: string[],
  displayScore: number,
): SmartCatalogSearchResultRow {
  return {
    catalogItemId: id,
    title,
    url: `https://youtube.com/watch?v=${id}`,
    artist: null,
    thumbnail: null,
    provider: "youtube",
    durationSec: 200,
    curationRating: 0,
    viewCount: null,
    likeCount: null,
    baseFitScore: displayScore,
    displayScore,
    recommendedBecause: "",
    matchedTags: slugs,
    taxonomySlugs: slugs,
    tagScore: displayScore,
    vibeDelta: 0,
    score: displayScore,
    matchedRuleSlugs: [],
    matchedProfileDimensions: [],
    neutralHits: [],
    businessFitExplanations: [],
    profileDimensionHits: [],
    explainHuman: [],
    penaltyReasons: [],
    blockedReasons: [],
    ruleBreakdown: [],
    businessDaypartVibe: null,
  };
}

const q1 = parseLocalSearchIntents("ים תיכוני SELECTED");
assert(
  q1.groups.some((g) => g.id === "mediterranean") && q1.groups.some((g) => g.id === "selected"),
  "ים תיכוני SELECTED → Mediterranean + Selected groups",
);

const q2 = parseLocalSearchIntents("ים תיכוני רגוע");
assert(
  q2.groups.some((g) => g.id === "mediterranean") && q2.groups.some((g) => g.id === "mood_calm"),
  "ים תיכוני רגוע → Mediterranean + Calm",
);

const q3 = parseLocalSearchIntents("1980 מובחרים");
assert(
  q3.groups.some((g) => g.id === "decade_1980") && q3.groups.some((g) => g.id === "selected"),
  "1980 מובחרים → 1980s + Selected",
);

const q4 = parseLocalSearchIntents("ROCK EASY");
assert(
  q4.groups.some((g) => g.id === "rock") && q4.groups.some((g) => g.id === "mood_calm"),
  "ROCK EASY → Rock + Easy",
);

const intents = q1;
const full = mockRow("full", "Mizrahi Selected Hit", ["oriental", "selected"], 0.5);
const partialSelected = mockRow("ps", "Bossa Selected", ["bossa-nova", "selected"], 0.9);
const partialMed = mockRow("pm", "Oriental Only", ["oriental"], 0.85);
const unrelated = mockRow("bad", "Melodic House EDM", ["melodic-house", "edm"], 0.99);

const ranked = rankCatalogRowsForAiIntents([unrelated, partialSelected, partialMed, full], intents);
assert(ranked[0]?.catalogItemId === "full", "full Mediterranean+Selected ranks first");
assert(
  scoreCatalogRowForAiIntents(unrelated, intents).groupsMatched === 0,
  "unrelated EDM has zero intent groups matched",
);
assert(
  scoreCatalogRowForAiIntents(partialSelected, intents).groupsMatched === 1,
  "selected-only row is partial (1 group)",
);

// ---- Pilot Blocker (Part 1) — Jazz strictness / parser-slug floor ----
//
// "jazz" must produce a substantive jazz_family intent group, AND the parser-slug
// floor must keep bossa-nova / afro / lounge OUT of the catalog selection even
// when they score high on displayScore.
const qJazz = parseLocalSearchIntents("jazz");
assert(
  qJazz.groups.some((g) => g.id === "jazz_family"),
  "'jazz' → jazz_family local intent group",
);
const qJazzHe = parseLocalSearchIntents("ג׳אז");
assert(
  qJazzHe.groups.some((g) => g.id === "jazz_family"),
  "'ג׳אז' → jazz_family local intent group",
);

const jazzParsed = parseSmartCatalogQuery("jazz");
assert(
  jazzParsed.styleTaxonomySlugs.includes("jazz"),
  "parseSmartCatalogQuery('jazz') yields 'jazz' style taxonomy slug",
);

const jazzRow = mockRow("jazz1", "Real Jazz Quartet", ["jazz"], 0.6);
const smoothJazz = mockRow("sj1", "Smooth Jazz Hour", ["smooth-jazz"], 0.55);
const bossaRow = mockRow("bossa1", "Brazilian Bossa", ["bossa-nova"], 0.9);
const afroRow = mockRow("afro1", "Afro House Vibes", ["afro", "afro-house"], 0.95);
const loungeRow = mockRow("lounge1", "Lounge Hour", ["lounge"], 0.88);

assert(
  catalogRowMatchesParserSlugs(jazzRow, ["jazz"]),
  "jazz row passes parser-slug floor for ['jazz']",
);
assert(
  catalogRowMatchesParserSlugs(smoothJazz, ["jazz", "smooth-jazz", "swing", "acid-jazz", "gipsy-jazz"]),
  "smooth-jazz row passes parser-slug floor for jazz_family slugs",
);
assert(
  !catalogRowMatchesParserSlugs(bossaRow, ["jazz"]),
  "bossa-nova row does NOT pass parser-slug floor for ['jazz']",
);
assert(
  !catalogRowMatchesParserSlugs(afroRow, ["jazz"]),
  "afro row does NOT pass parser-slug floor for ['jazz']",
);
assert(
  !catalogRowMatchesParserSlugs(loungeRow, ["jazz"]),
  "lounge row does NOT pass parser-slug floor for ['jazz']",
);

// Jazz_family taxonomy slugs as the floor (matches the dictionary entry).
const jazzFamilyFloor = ["jazz", "smooth-jazz", "swing", "acid-jazz", "gipsy-jazz"];
const split = splitCatalogPoolByParserSlugOverlap(
  [jazzRow, smoothJazz, bossaRow, afroRow, loungeRow],
  jazzFamilyFloor,
);
assert(
  split.parserMatch.length === 2 &&
    split.parserMatch.some((r) => r.catalogItemId === "jazz1") &&
    split.parserMatch.some((r) => r.catalogItemId === "sj1"),
  "parser-slug floor admits only jazz / smooth-jazz rows for jazz_family",
);
assert(
  split.noParserMatch.length === 3 &&
    split.noParserMatch.every((r) => ["bossa1", "afro1", "lounge1"].includes(r.catalogItemId)),
  "parser-slug floor rejects bossa-nova / afro / lounge for jazz_family",
);

// Empty parser slugs → no floor enforced.
const noFloor = splitCatalogPoolByParserSlugOverlap([jazzRow, bossaRow], []);
assert(noFloor.parserMatch.length === 2 && noFloor.noParserMatch.length === 0, "empty parserSlugs disables the floor");

// ---- Local strict floor (Pilot Blocker — Local Jazz strictness) ----
//
// Helper local-candidate factory. matchDebug is shaped like the scorer's output.
function mkLocalCand(args: {
  absolutePath: string;
  genre?: string | null;
  comment?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  matchedFields?: string[];
}) {
  return {
    absolutePath: args.absolutePath,
    genre: args.genre ?? null,
    comment: args.comment ?? null,
    title: args.title ?? null,
    artist: args.artist ?? null,
    album: args.album ?? null,
    matchDebug: {
      groupsMatched: args.matchedFields?.length ? 1 : 0,
      groupsTotal: 1,
      fullMatch: !!args.matchedFields?.length,
      score: 24,
      reason: "synthetic",
      groups: [
        {
          label: "Jazz",
          matched: !!args.matchedFields?.length,
          terms: ["jazz"],
          fields: args.matchedFields ?? [],
        },
      ],
    },
  };
}

const trustedLabels = getTrustedFolderLabelsForParserSlugs(["jazz"]);
assert(
  trustedLabels.includes("jazz") &&
    trustedLabels.includes("jazz - general") &&
    trustedLabels.includes("jazz - smooth") &&
    trustedLabels.includes("jazz - swing"),
  "trusted folder labels include jazz, jazz - general, jazz - smooth, jazz - swing",
);
assert(
  trustedLabels.includes("smooth-jazz") && trustedLabels.includes("smooth jazz"),
  "trusted folder labels include smooth-jazz + dash-to-space variant",
);
assert(
  trustedLabels.includes("ג׳אז") && trustedLabels.includes("גאז"),
  "trusted labels include Hebrew jazz variants from the dictionary",
);

// Strong-field cases.
const id3Jazz = mkLocalCand({
  absolutePath: "D:/Library/Music/Various/Real Jazz Track.mp3",
  genre: "Jazz",
  title: "Real Jazz Track",
  artist: "Quartet",
  matchedFields: ["genre", "path"],
});
assert(
  evaluateLocalStrictFloor({ candidate: id3Jazz, parserSlugs: ["jazz"] }).pass,
  "ID3 genre=Jazz row passes local strict floor",
);

const commentJazz = mkLocalCand({
  absolutePath: "D:/Library/Music/Various/Track.mp3",
  comment: "Smooth Jazz selection · curated",
  matchedFields: ["comment"],
});
assert(
  evaluateLocalStrictFloor({ candidate: commentJazz, parserSlugs: ["jazz"] }).pass,
  "ID3 comment containing 'jazz' passes local strict floor",
);

// Trusted folder cases (path-only match in a PlaylistPro jazz bucket).
const playlistProJazz = mkLocalCand({
  absolutePath: "D:/Library/PlaylistPro/JAZZ - General/01 - Some Track.mp3",
  matchedFields: ["path"],
});
const decision1 = evaluateLocalStrictFloor({
  candidate: playlistProJazz,
  parserSlugs: ["jazz"],
});
assert(decision1.pass && decision1.reason === "trusted_folder", "JAZZ - General folder is a trusted match");

const playlistProSmooth = mkLocalCand({
  absolutePath: "D:/Library/PlaylistPro/JAZZ - Smooth/Smoothie.mp3",
  matchedFields: ["path"],
});
assert(
  evaluateLocalStrictFloor({ candidate: playlistProSmooth, parserSlugs: ["jazz"] }).pass,
  "JAZZ - Smooth folder is a trusted match",
);

// Generic user-named "Jazz" folder also passes (whole-word folder segment).
const userJazzFolder = mkLocalCand({
  absolutePath: "D:/My Music/Jazz/Track.mp3",
  matchedFields: ["path"],
});
assert(
  evaluateLocalStrictFloor({ candidate: userJazzFolder, parserSlugs: ["jazz"] }).pass,
  "Folder named 'Jazz' is a trusted match",
);

// Rejection cases.
const jazzanovaArtist = mkLocalCand({
  absolutePath: "D:/Library/Artists/Jazzanova/Boogie Woogie.mp3",
  matchedFields: ["path"],
});
const decision2 = evaluateLocalStrictFloor({
  candidate: jazzanovaArtist,
  parserSlugs: ["jazz"],
});
assert(!decision2.pass, "Artist folder 'Jazzanova' is REJECTED (word-boundary, no genre/comment)");

const jazzInFilenameOnly = mkLocalCand({
  absolutePath: "D:/Library/Music/Random Folder/My Jazz Cover.mp3",
  matchedFields: ["path"],
});
assert(
  !evaluateLocalStrictFloor({ candidate: jazzInFilenameOnly, parserSlugs: ["jazz"] }).pass,
  "Filename-only 'jazz' (no genre/folder) is REJECTED",
);

const blankPathOnly = mkLocalCand({
  absolutePath: "D:/Library/Music/Misc/Track.mp3",
  matchedFields: ["path"],
});
assert(
  !evaluateLocalStrictFloor({ candidate: blankPathOnly, parserSlugs: ["jazz"] }).pass,
  "Path that doesn't contain jazz at all is REJECTED (impossible to reach here in practice, but safe)",
);

/*
 * Pilot Blocker: title-only / artist-only / album-only matches must NOT
 * pass for a direct genre prompt. Previously the floor accepted these via
 * the matchDebug strong-field path AND via a fallback label scan over
 * title/artist/album. Both paths are now blocked — only genre / comment /
 * year / trusted folder count.
 */
const titleOnlyJazz = mkLocalCand({
  absolutePath: "D:/Library/Music/Various/Random Folder/track.mp3",
  title: "Smooth Jazz Lounge",
  matchedFields: ["title"],
});
assert(
  !evaluateLocalStrictFloor({ candidate: titleOnlyJazz, parserSlugs: ["jazz"] }).pass,
  "ID3 title='Smooth Jazz Lounge' alone is REJECTED for prompt JAZZ",
);

const artistOnlyJazz = mkLocalCand({
  absolutePath: "D:/Library/Music/Various/Random Folder/track.mp3",
  artist: "The Jazz Trio",
  matchedFields: ["artist"],
});
assert(
  !evaluateLocalStrictFloor({ candidate: artistOnlyJazz, parserSlugs: ["jazz"] }).pass,
  "ID3 artist='The Jazz Trio' alone is REJECTED for prompt JAZZ",
);

const albumOnlyJazz = mkLocalCand({
  absolutePath: "D:/Library/Music/Various/Random Folder/track.mp3",
  album: "Jazz Standards Vol. 1",
  matchedFields: ["album"],
});
assert(
  !evaluateLocalStrictFloor({ candidate: albumOnlyJazz, parserSlugs: ["jazz"] }).pass,
  "ID3 album='Jazz Standards Vol. 1' alone is REJECTED for prompt JAZZ",
);

// Edge: title contains jazz BUT genre also supports it → passes via genre.
const titleAndGenreJazz = mkLocalCand({
  absolutePath: "D:/Library/Music/Various/Random Folder/track.mp3",
  genre: "Jazz",
  title: "Smooth Jazz Lounge",
  matchedFields: ["title", "genre"],
});
assert(
  evaluateLocalStrictFloor({ candidate: titleAndGenreJazz, parserSlugs: ["jazz"] }).pass,
  "Title-jazz + ID3 genre=Jazz is ADMITTED (genre still wins)",
);

// Edge: title-only + trusted folder → passes via folder.
const titleJazzInTrustedFolder = mkLocalCand({
  absolutePath: "D:/Library/PlaylistPro/JAZZ - General/track.mp3",
  title: "Some Title With Jazz Word",
  matchedFields: ["title", "path"],
});
assert(
  evaluateLocalStrictFloor({ candidate: titleJazzInTrustedFolder, parserSlugs: ["jazz"] }).pass,
  "Title-jazz + trusted folder is ADMITTED (folder still wins)",
);

// Empty parser slugs → no floor (no regression).
assert(
  evaluateLocalStrictFloor({ candidate: jazzanovaArtist, parserSlugs: [] }).pass,
  "Empty parser slugs disable the local floor (Jazzanova passes)",
);

// Batch partition behavior.
const batch = [id3Jazz, commentJazz, playlistProJazz, jazzanovaArtist, jazzInFilenameOnly];
const partition = applyLocalStrictFloor(batch, ["jazz"]);
assert(
  partition.passing.length === 3 && partition.rejected.length === 2,
  "applyLocalStrictFloor partitions 5 candidates → 3 pass / 2 reject",
);
assert(
  partition.rejected.every((r) => r.decision.reason === "weak_path_only"),
  "rejected candidates carry weak_path_only reason",
);
const noFloorPartition = applyLocalStrictFloor(batch, []);
assert(
  noFloorPartition.passing.length === 5 && noFloorPartition.rejected.length === 0,
  "Empty parserSlugs → applyLocalStrictFloor returns all candidates",
);

// Workout (gym / high energy) must still produce a substantive intent and not regress.
const qWorkout = parseLocalSearchIntents("workout");
// 'workout' itself isn't a substantive dictionary group, but 'gym' / 'high energy' would be.
// Keep this loose: just verify no crash and parse succeeds.
assert(Array.isArray(qWorkout.groups), "'workout' parses without crashing");

// ים תיכוני רגוע unchanged.
const qMedCalm2 = parseLocalSearchIntents("ים תיכוני רגוע");
assert(
  qMedCalm2.groups.some((g) => g.id === "mediterranean") &&
    qMedCalm2.groups.some((g) => g.id === "mood_calm"),
  "ים תיכוני רגוע still parses as Mediterranean + Calm (no regression)",
);

const coverA = buildDeterministicAiPlaylistCover("ים תיכוני SELECTED");
const coverB = buildDeterministicAiPlaylistCover("ROCK EASY");
assert(coverA !== coverB, "deterministic covers differ by playlist intent/title");

const pickedCover = pickAiPlaylistThumbnail(
  [{ id: "1", name: "Local", type: "local", url: "C:/music/a.mp3" }],
  "ים תיכוני SELECTED",
);
assert(pickedCover.startsWith("data:image/svg+xml"), "local-only playlist uses deterministic cover");

// ---- Combined-intent strictness (pilot blocker) ----
//
// "1980 רגוע מובחרים" parses into 3 substantive groups: decade_1980 + mood_calm + selected.
// When strictMultiIntent is enabled, only rows that match ALL three groups may be
// admitted. The partial-match fallback is disabled; the build short-circuits to a
// shorter accurate playlist instead of padding with rows that satisfy only `selected`
// (which is how a "Jazz · Selected" YouTube row leaked into a "calm 1980" build).
const qCombined = parseLocalSearchIntents("1980 רגוע מובחרים");
assert(
  qCombined.groups.some((g) => g.id === "decade_1980") &&
    qCombined.groups.some((g) => g.id === "mood_calm") &&
    qCombined.groups.some((g) => g.id === "selected"),
  "'1980 רגוע מובחרים' → decade_1980 + mood_calm + selected",
);
assert(
  isSubstantiveMultiIntentQuery(qCombined),
  "'1980 רגוע מובחרים' is recognised as a multi-intent prompt",
);

// Taxonomy slugs match the intent dictionary entries for decade_1980,
// mood_calm, and selected (lib/dj-intent-dictionary.ts).
const fullCombo = mockRow(
  "fc",
  "Mellow 1980 Pick",
  ["80s-new-wave-pop", "chill-mellow", "selected"],
  0.7,
);
const onlySelected = mockRow(
  "os",
  "Jazz · Selected (no decade, no calm)",
  ["jazz", "selected"],
  0.99,
);
const only1980 = mockRow(
  "o80",
  "1980 Hard Rock (not calm, not selected)",
  ["80s-new-wave-pop", "classic-rock"],
  0.85,
);
const onlyCalm = mockRow("oc", "Calm New-Age", ["chill-mellow", "ambient"], 0.6);
const rankedCombo = rankCatalogRowsForAiIntents(
  [onlySelected, fullCombo, only1980, onlyCalm],
  qCombined,
);
assert(
  rankedCombo[0]?.catalogItemId === "fc",
  "full combined match ranks first across decade+calm+selected",
);

// Verify the pool partition that the strict-multi-intent selector relies on.
// In strictMultiIntent mode `selectIntentCatalogTracks` (ai-playlist-generation.ts)
// admits ONLY rows from `fullMatch` and never falls back to `partialMatch`.
// That partition is what we exercise here to keep this test runnable under tsx
// (importing the generation module pulls in `server-only` transitively).
const splitCombo = splitCatalogPoolByIntentMatch(rankedCombo);
assert(
  splitCombo.fullMatch.length === 1 && splitCombo.fullMatch[0]?.catalogItemId === "fc",
  "strictMultiIntent pool partition: only the all-3-groups row is full",
);
assert(
  splitCombo.partialMatch.length === 3 &&
    splitCombo.partialMatch.some((r) => r.catalogItemId === "os") &&
    splitCombo.partialMatch.some((r) => r.catalogItemId === "o80") &&
    splitCombo.partialMatch.some((r) => r.catalogItemId === "oc"),
  "strictMultiIntent pool partition: Jazz/Selected, 1980 Rock, Calm New-Age are partial",
);
assert(
  splitCombo.noMatch.length === 0,
  "strictMultiIntent pool partition: every row matched at least one group",
);

// Per-row fullMatch is the contract that the local-side strict filter checks
// (`localCandidates.filter((c) => c.matchDebug?.fullMatch === true)`).
assert(
  splitCombo.fullMatch[0]?.intentMatch.fullMatch === true,
  "fullMatch row carries intentMatch.fullMatch=true",
);
assert(
  splitCombo.partialMatch.every((r) => r.intentMatch.fullMatch === false),
  "every partialMatch row carries intentMatch.fullMatch=false",
);

// Single-intent prompts must NOT trigger strict mode (workout/jazz should still
// be allowed to fall through to partial matches when needed).
assert(
  !isSubstantiveMultiIntentQuery(parseLocalSearchIntents("jazz")),
  "single-intent 'jazz' is NOT recognised as multi-intent",
);

// ---- Sibling exclusion (Israeli must not pull Mediterranean / Jazz) ----
//
// Pilot Blocker: a prompt that activates `israeli` but not `mediterranean`
// must reject rows belonging to Mediterranean/Mizrahi territory. The user
// can opt back in by including "ים תיכוני" / "mizrahi" / "oriental".
const qIsraeliCalmHits = parseLocalSearchIntents("ישראלי רגוע להיטים 2026");
assert(
  qIsraeliCalmHits.groups.some((g) => g.id === "israeli") &&
    qIsraeliCalmHits.groups.some((g) => g.id === "mood_calm") &&
    qIsraeliCalmHits.groups.some((g) => g.id === "hits"),
  "'ישראלי רגוע להיטים 2026' → israeli + mood_calm + hits",
);

const israeliBundle = buildSiblingExclusionBundle(qIsraeliCalmHits);
assert(
  israeliBundle.excludedGroupIds.includes("mediterranean"),
  "'ישראלי' without 'ים תיכוני' excludes the mediterranean sibling",
);
assert(
  israeliBundle.excludedGroupIds.includes("jazz_family"),
  "'ישראלי' without 'jazz' excludes the jazz_family sibling",
);
assert(
  israeliBundle.excludedTaxonomySlugSet.has("oriental") &&
    israeliBundle.excludedTaxonomySlugSet.has("mediterranean-pop") &&
    israeliBundle.excludedTaxonomySlugSet.has("middle-eastern-beats"),
  "Mediterranean taxonomy slugs are present in the exclusion bundle",
);
assert(
  israeliBundle.excludedTaxonomySlugSet.has("jazz") &&
    israeliBundle.excludedTaxonomySlugSet.has("smooth-jazz"),
  "Jazz family taxonomy slugs are present in the exclusion bundle",
);

const israeliMizrahiRow = mockRow(
  "imm",
  "Mizrahi Israeli Hit",
  ["israeli-hits", "oriental", "hits", "chill-mellow"],
  0.95,
);
const pureIsraeliRow = mockRow(
  "pi",
  "Israeli Soft Hit",
  ["israeli-hits", "hits", "chill-mellow"],
  0.7,
);
const israeliJazzRow = mockRow(
  "ij",
  "Israeli Jazz Quartet",
  ["israeli-hits", "smooth-jazz", "chill-mellow"],
  0.7,
);
const reggaeRow = mockRow(
  "rg",
  "Imported Reggae Track",
  ["reggae", "world", "chill-mellow"],
  0.99,
);

assert(
  catalogRowMatchesExcludedSibling(israeliMizrahiRow, israeliBundle),
  "Mizrahi/Oriental catalog row is excluded for an Israeli-only prompt",
);
assert(
  catalogRowMatchesExcludedSibling(israeliJazzRow, israeliBundle),
  "Israeli-Jazz catalog row is excluded for an Israeli-only prompt",
);
assert(
  !catalogRowMatchesExcludedSibling(pureIsraeliRow, israeliBundle),
  "Pure Israeli catalog row is admitted",
);
assert(
  !catalogRowMatchesExcludedSibling(reggaeRow, israeliBundle),
  "Reggae row is NOT excluded by sibling rules (it gets dropped by strict intent floor — not by sibling exclusion)",
);

// Opt-in: user explicitly asks for Mediterranean, lifting the exclusion.
const qIsraeliMizrahi = parseLocalSearchIntents("ישראלי ים תיכוני רגוע");
const optInBundle = buildSiblingExclusionBundle(qIsraeliMizrahi);
assert(
  !optInBundle.excludedGroupIds.includes("mediterranean"),
  "Including 'ים תיכוני' lifts the mediterranean exclusion",
);
assert(
  !catalogRowMatchesExcludedSibling(israeliMizrahiRow, optInBundle),
  "Mizrahi row is ADMITTED when the user explicitly requests Mediterranean",
);

// Local exclusion — uses the candidate's text fields (genre / comment / path).
const localMizrahiByGenre = {
  absolutePath: "C:/Music/Israeli/Track.mp3",
  genre: "Israeli Mizrahi",
  comment: null,
  title: "Track",
  artist: "אמן",
  album: null,
};
assert(
  localCandidateMatchesExcludedSibling(localMizrahiByGenre, israeliBundle),
  "Local file with genre='Israeli Mizrahi' is excluded for an Israeli-only prompt",
);

const localMizrahiByPath = {
  absolutePath: "C:/Music/Mizrahi/Track.mp3",
  genre: null,
  comment: null,
  title: "Track",
  artist: null,
  album: null,
};
assert(
  localCandidateMatchesExcludedSibling(localMizrahiByPath, israeliBundle),
  "Local file in a 'Mizrahi' folder is excluded for an Israeli-only prompt",
);

const localJazzanovaArtistName = {
  absolutePath: "C:/Music/Israeli/Jazzanova - Song.mp3",
  genre: "Israeli Pop",
  comment: null,
  title: "Song",
  artist: "Jazzanova",
  album: null,
};
assert(
  !localCandidateMatchesExcludedSibling(localJazzanovaArtistName, israeliBundle),
  "Local file with artist 'Jazzanova' is NOT excluded by jazz sibling (word-boundary check on path)",
);

const localPureIsraeli = {
  absolutePath: "C:/Music/Israeli/Pop/Track.mp3",
  genre: "Israeli Pop",
  comment: null,
  title: "Track",
  artist: "אמן",
  album: null,
};
assert(
  !localCandidateMatchesExcludedSibling(localPureIsraeli, israeliBundle),
  "Pure Israeli local file is admitted under Israeli-only prompt",
);

// No active intents → empty bundle, no exclusion regression.
const emptyBundle = buildSiblingExclusionBundle(null);
assert(
  emptyBundle.excludedGroupIds.length === 0,
  "Null intents → empty exclusion bundle (no regression)",
);
const calmOnlyBundle = buildSiblingExclusionBundle(parseLocalSearchIntents("רגוע"));
assert(
  calmOnlyBundle.excludedGroupIds.length === 0,
  "'רגוע' alone doesn't activate sibling exclusion (no group declares siblings for mood_calm)",
);

if (process.exitCode === 1) {
  console.error("\nSome intent/cover checks failed.");
  process.exit(1);
}

console.log("\nAll AI playlist intent/cover checks passed.");
