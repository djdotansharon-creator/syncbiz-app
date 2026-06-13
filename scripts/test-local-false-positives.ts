/**
 * Ad-hoc verification of Fix A (word-boundary + "best" drop from SELECTED) and Fix B
 * (XLSX preservation when ID3 returns null). Run with: npx tsx scripts/test-local-false-positives.ts
 */

import {
  parseLocalSearchIntents,
  scoreLocalTrackForAiSearch,
  type LocalAiSearchTrackFields,
} from "../desktop/src/shared/local-ai-playlist-search";
import {
  upsertLocalTrackIntoSnapshot,
  type LocalCollectionSnapshotFile,
} from "../desktop/src/main/local-collection-snapshot";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL", msg);
    failures += 1;
  } else {
    console.log("OK", msg);
  }
}

function mkRow(overrides: Partial<LocalAiSearchTrackFields>): LocalAiSearchTrackFields {
  return {
    artist: null,
    title: null,
    album: null,
    genre: null,
    year: null,
    comment: null,
    bpm: null,
    rating: null,
    trackNumber: null,
    durationSec: 200,
    relativePathFromRoot: "misc/track.mp3",
    absolutePath: "D:/lib/misc/track.mp3",
    ...overrides,
  };
}

// ---- Fix A scenarios ----

// 1. "Best of Sting" in title alone must NOT trigger SELECTED.
{
  const intents = parseLocalSearchIntents("ים תיכוני SELECTED");
  const row = mkRow({
    title: "Best of Sting",
    artist: "Sting",
    genre: "Mediterranean",
    relativePathFromRoot: "Mediterranean/Best of Sting.mp3",
    absolutePath: "D:/lib/Mediterranean/Best of Sting.mp3",
  });
  const res = scoreLocalTrackForAiSearch(row, intents);
  const selectedHit = res.groupMatches.find((g) => g.groupId === "selected");
  assert(
    !!selectedHit && !selectedHit.matched,
    "title 'Best of Sting' (no SELECTED tag) must NOT match SELECTED group",
  );
}

// 1b. Same row, but with comment='SELECTED' → SELECTED group MUST match (via comment).
{
  const intents = parseLocalSearchIntents("ים תיכוני SELECTED");
  const row = mkRow({
    title: "Best of Sting",
    artist: "Sting",
    genre: "Mediterranean",
    comment: "SELECTED",
    relativePathFromRoot: "Mediterranean/Best of Sting.mp3",
    absolutePath: "D:/lib/Mediterranean/Best of Sting.mp3",
  });
  const res = scoreLocalTrackForAiSearch(row, intents);
  const selectedHit = res.groupMatches.find((g) => g.groupId === "selected");
  assert(
    !!selectedHit && selectedHit.matched && selectedHit.matchedFields.includes("comment"),
    "comment='SELECTED' on same row DOES match SELECTED via comment",
  );
}

// 2a. "Easy Lover" title — "easy" as standalone word — MUST match mood_calm.
{
  const intents = parseLocalSearchIntents("רגוע");
  const row = mkRow({
    title: "Easy Lover",
    artist: "Phil Collins",
    genre: "Pop",
    relativePathFromRoot: "Pop/Easy Lover.mp3",
    absolutePath: "D:/lib/Pop/Easy Lover.mp3",
  });
  const res = scoreLocalTrackForAiSearch(row, intents);
  const calmHit = res.groupMatches.find((g) => g.groupId === "mood_calm");
  assert(
    !!calmHit && calmHit.matched,
    "title 'Easy Lover' (standalone 'easy' word) DOES match Calm/Easy",
  );
}

// 2b. "easygoing" embedded title MUST NOT match mood_calm via title alone.
//     We isolate the title path: comment/genre/folder/etc. give no Calm signal.
{
  const intents = parseLocalSearchIntents("רגוע");
  const row = mkRow({
    title: "Easygoing Vibes",
    artist: "Some Band",
    genre: "Pop",
    relativePathFromRoot: "Pop/Easygoing Vibes.mp3",
    absolutePath: "D:/lib/Pop/Easygoing Vibes.mp3",
  });
  const res = scoreLocalTrackForAiSearch(row, intents);
  const calmHit = res.groupMatches.find((g) => g.groupId === "mood_calm");
  assert(
    !calmHit?.matched,
    "title 'Easygoing Vibes' (no 'easy' word boundary) does NOT match Calm/Easy",
  );
}

// 2c. "Soft" embedded in "Microsoft Office" must not match mood_calm.
{
  const intents = parseLocalSearchIntents("רגוע");
  const row = mkRow({
    title: "Microsoft Office Theme",
    artist: "OST",
    genre: "Electronic",
    relativePathFromRoot: "Electronic/Microsoft Office Theme.mp3",
    absolutePath: "D:/lib/Electronic/Microsoft Office Theme.mp3",
  });
  const res = scoreLocalTrackForAiSearch(row, intents);
  const calmHit = res.groupMatches.find((g) => g.groupId === "mood_calm");
  assert(
    !calmHit?.matched,
    "title 'Microsoft Office Theme' (embedded 'soft') does NOT leak into Calm/Easy",
  );
}

// 2d. "Rocker" title must not falsely match Rock when prompt is rock.
{
  const intents = parseLocalSearchIntents("ROCK EASY");
  const row = mkRow({
    title: "Rocker Skater",
    artist: "Acoustic Joe",
    genre: "Folk",
    comment: "calm",
    relativePathFromRoot: "Folk/Rocker Skater.mp3",
    absolutePath: "D:/lib/Folk/Rocker Skater.mp3",
  });
  const res = scoreLocalTrackForAiSearch(row, intents);
  const rockHit = res.groupMatches.find((g) => g.groupId === "rock");
  assert(
    !rockHit?.matched,
    "title 'Rocker Skater' (no 'rock' word boundary) does NOT match Rock group",
  );
}

// 2e. Sanity: comment='calm' still matches mood_calm via comment (Latin word in comment).
{
  const intents = parseLocalSearchIntents("רגוע");
  const row = mkRow({
    title: "Some Title",
    artist: "Some Artist",
    genre: "Pop",
    comment: "calm",
    relativePathFromRoot: "Pop/Some Title.mp3",
    absolutePath: "D:/lib/Pop/Some Title.mp3",
  });
  const res = scoreLocalTrackForAiSearch(row, intents);
  const calmHit = res.groupMatches.find((g) => g.groupId === "mood_calm");
  assert(
    !!calmHit && calmHit.matched && calmHit.matchedFields.includes("comment"),
    "comment='calm' still matches Calm/Easy via comment field",
  );
}

// 2f. Hebrew term match unaffected: 'רגוע' in comment still hits substring.
{
  const intents = parseLocalSearchIntents("רגוע");
  const row = mkRow({
    title: "T",
    comment: "רגוע ים תיכוני",
    relativePathFromRoot: "x/track.mp3",
    absolutePath: "D:/lib/x/track.mp3",
  });
  const res = scoreLocalTrackForAiSearch(row, intents);
  const calmHit = res.groupMatches.find((g) => g.groupId === "mood_calm");
  assert(!!calmHit?.matched, "Hebrew רגוע in comment still matches Calm/Easy");
}

// ---- Fix B scenario: XLSX comment/bpm/rating survives a null ID3 read ----

function freshSnapshot(): LocalCollectionSnapshotFile {
  return {
    schemaVersion: 2,
    workspaceId: null,
    deviceId: "test-device",
    musicFolderRoot: "D:/lib",
    tracks: {},
    updatedAt: new Date().toISOString(),
  };
}

{
  const snap = freshSnapshot();
  const absolutePath = "D:/lib/Mediterranean/some-track.mp3";
  // Step 1 — XLSX import writes the row with curator tags.
  upsertLocalTrackIntoSnapshot(snap, {
    absolutePath,
    musicRootNorm: "D:/lib",
    size: 1000,
    mtimeMs: 12345,
    tags: {
      artist: "Artist",
      title: "Title",
      album: "Album",
      genre: null,
      year: "1985",
      comment: "SELECTED · MEDITERRANEAN",
      bpm: 110,
      rating: 4.5,
      durationSec: 200,
      trackNumber: "3",
    },
    preserveTagsOnStatOnly: false,
  });
  const ids = Object.keys(snap.tracks);
  const beforeKey = ids[0]!;
  const before = snap.tracks[beforeKey]!;
  assert(before.comment === "SELECTED · MEDITERRANEAN", "XLSX comment present after import");
  assert(before.bpm === 110, "XLSX bpm present after import");
  assert(before.rating === 4.5, "XLSX rating present after import");

  // Step 2 — Browse-driven ID3 read for the same file produces null comment/bpm/rating.
  //          With Fix B the flush-write replaces null incoming with undefined for those
  //          three fields, so they remain on the snapshot. We emulate the post-Fix B
  //          call here directly so this test does not need filesystem state.
  upsertLocalTrackIntoSnapshot(snap, {
    absolutePath,
    musicRootNorm: "D:/lib",
    size: 1000,
    mtimeMs: 12345,
    tags: {
      artist: "Artist",
      title: "Title",
      album: "Album",
      genre: null,
      year: "1985",
      comment: undefined,
      durationSec: 200,
      bpm: undefined,
      rating: undefined,
    },
    preserveTagsOnStatOnly: false,
  });
  const afterKey = Object.keys(snap.tracks)[0]!;
  const after = snap.tracks[afterKey]!;
  assert(
    after.comment === "SELECTED · MEDITERRANEAN",
    "comment preserved after null-ID3 browse re-read",
  );
  assert(after.bpm === 110, "bpm preserved after null-ID3 browse re-read");
  assert(after.rating === 4.5, "rating preserved after null-ID3 browse re-read");

  // Step 3 — Real ID3 with a non-null comment must still override (XLSX is not sacred when
  //          ID3 has real data).
  upsertLocalTrackIntoSnapshot(snap, {
    absolutePath,
    musicRootNorm: "D:/lib",
    size: 1000,
    mtimeMs: 12345,
    tags: {
      artist: "Artist",
      title: "Title",
      album: "Album",
      genre: null,
      year: "1985",
      comment: "real id3 comment",
      durationSec: 200,
      bpm: 120,
      rating: 3,
    },
    preserveTagsOnStatOnly: false,
  });
  const final = snap.tracks[Object.keys(snap.tracks)[0]!]!;
  assert(final.comment === "real id3 comment", "non-null ID3 comment DOES override XLSX value");
  assert(final.bpm === 120, "non-null ID3 bpm DOES override XLSX value");
  assert(final.rating === 3, "non-null ID3 rating DOES override XLSX value");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll local search false-positive + XLSX preservation checks passed.");
