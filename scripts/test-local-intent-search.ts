import {
  parseLocalSearchIntents,
  scoreLocalTrackForAiSearch,
  rankLocalAiSearchResults,
} from "../desktop/src/shared/local-ai-playlist-search";

const medCalm = {
  artist: "Artist",
  title: "Song",
  album: null,
  genre: "Mizrahi",
  year: "1990",
  comment: "calm easy",
  bpm: 88,
  rating: 4,
  trackNumber: null,
  durationSec: 200,
  relativePathFromRoot: "Mizrahi/Calm/easy track.mp3",
  absolutePath: "D:/x/Mizrahi/Calm/easy track.mp3",
};
const onlyEasy80 = {
  artist: "A",
  title: "B",
  album: null,
  genre: "Pop",
  year: "1980",
  comment: null,
  bpm: 120,
  rating: 3,
  trackNumber: null,
  durationSec: 200,
  relativePathFromRoot: "1980's - Easy/Track.mp3",
  absolutePath: "D:/x/1980's - Easy/Track.mp3",
};
const rockEasy = {
  artist: "Band",
  title: "Riff",
  album: null,
  genre: "Rock Easy",
  year: "2000",
  comment: "classic rock mellow",
  bpm: 95,
  rating: 4,
  trackNumber: null,
  durationSec: 240,
  relativePathFromRoot: "Rock/Easy/Band - Riff.mp3",
  absolutePath: "D:/x/Rock/Easy/Band - Riff.mp3",
};

for (const q of ["ים תיכוני רגוע", "ROCK EASY", "1980 מובחרים", "רגוע"]) {
  const intents = parseLocalSearchIntents(q);
  const rows = [medCalm, onlyEasy80, rockEasy].map((row) => {
    const s = scoreLocalTrackForAiSearch(row, intents);
    return {
      title: row.relativePathFromRoot,
      score: s.score,
      full: s.fullMatch,
      gm: s.groupsMatched,
      gt: s.groupsTotal,
      reason: s.reason,
      matchDebug: {
        fullMatch: s.fullMatch,
        groupsMatched: s.groupsMatched,
        groupsTotal: s.groupsTotal,
        score: s.score,
        reason: s.reason,
        groups: [],
      },
    };
  });
  const ranked = rankLocalAiSearchResults(rows, intents).results;
  console.log("\nQUERY:", q, "groups:", intents.groups.map((g) => g.label).join(", "));
  for (const r of ranked) {
    console.log(`  ${r.full ? "FULL" : "PART"} ${r.score}\t${r.title}`);
    console.log(`    ${r.reason}`);
  }
}
