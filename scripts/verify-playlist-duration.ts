/**
 * PLAYLIST LENGTH (owner 2026-11-15): lib/playlist-duration.ts (pure) + the store / route wiring + the studio's lookup on placing.
 * Run: npx tsx scripts/verify-playlist-duration.ts
 */
import { readFileSync } from "node:fs";
import { playlistTotalSeconds, totalToStore, tracksMissingLength, withSingleTrackLength } from "../lib/playlist-duration";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗ FAIL:", m); } };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

console.log("PD1 — the total is the sum of the songs, never a partial sum");
ok(playlistTotalSeconds([{ durationSeconds: 200 }, { durationSeconds: 130 }, { durationSeconds: 61.4 }]) === 391, "3 known songs → 391 s");
ok(playlistTotalSeconds([{ durationSeconds: 200 }, {}]) === null, "one unknown song → the total is unknown (null), not 200");
ok(playlistTotalSeconds([{ durationSeconds: 0 }]) === null && playlistTotalSeconds([]) === null && playlistTotalSeconds(undefined) === null, "zero / no songs → unknown");

console.log("PD2 — a one-song playlist IS the song");
ok(withSingleTrackLength([{ id: "a" } as { id: string; durationSeconds?: number }], 245)[0]!.durationSeconds === 245, "the song takes the playlist's own length");
ok(withSingleTrackLength([{ durationSeconds: 100 }], 245)[0]!.durationSeconds === 100, "a song that has its own length keeps it");
ok(withSingleTrackLength<{ durationSeconds?: number }>([{}, {}], 245).every((t) => t.durationSeconds === undefined), "a longer list is never given the figure of one song");

console.log("PD3 — what is stored as the total");
ok(totalToStore([{ durationSeconds: 100 }, { durationSeconds: 50 }], 999) === 150, "every song known → the sum (the caller's figure is ignored)");
ok(totalToStore([{}], 245) === 245, "one song without a length → the caller's explicit figure");
ok(totalToStore([{}, {}], 245) === null, "a list of several songs with unknown lengths → null (the old figure of one song must not stay)");
ok(tracksMissingLength([{ durationSeconds: 5 }, {}, { durationSeconds: 0 }]).length === 2, "tracks still to look up are found");

console.log("PD4 — wiring");
const store = read("lib/playlist-store.ts");
ok(/track\.durationSeconds = item\.durationSec/.test(store) && /durationSec: typeof t\.durationSeconds === "number"/.test(store) && (store.match(/durationSec: typeof t\.durationSeconds/g) ?? []).length === 2, "the store reads and writes each song's length (create and update)");
ok(/durationSeconds: totalToStore\(tracks, normalized\.durationSeconds\)/.test(store) && /updateData\.durationSeconds = totalToStore\(tracks,/.test(store) && /playlistTotalSeconds\(tracks\) \?\? row\.durationSeconds/.test(store), "the total follows the songs on create and on every change of the songs");
ok(/durationSec Int\?/.test(read("prisma/schema.prisma")) && /ADD COLUMN "durationSec" INTEGER;/.test(read("prisma/migrations/20261115120000_playlist_item_duration/migration.sql")) && !/DROP|NOT NULL|UPDATE/.test(read("prisma/migrations/20261115120000_playlist_item_duration/migration.sql")), "the migration is ONE additive nullable column");
const route = read("app/api/playlists/[id]/refresh-duration/route.ts");
ok(/gatePlaylistAccess\(user \?\? null, playlist\)/.test(route) && /type === "youtube"/.test(route) && /resolveYouTubeMetadata\(t\.url\)/.test(route) && /Math\.min\(3, queue\.length\)/.test(route), "the lookup route has the playlist's own access rule, asks YouTube only for YouTube songs, 3 at a time");
ok(!/t\.type === "local"[^\n]*resolve/.test(route) && /a local file/.test(route), "a local file is never looked up or sent anywhere (its path stays on its machine)");
const studio = read("components/schedules-studio/schedules-studio.tsx");
// (rewritten 2026-11-16 with the exact-length drop: the ask is ONE shared promise per playlist (lengthLookups), the drop waits for it (LOOKUP_WAIT_MS) and the block takes the music's own length; with no answer the 5-minute stub, later corrected by learnLength)
ok(/refresh-duration/.test(studio) && /lengthLookups\.current\.get\(item\.targetId\)/.test(studio) && /lengthLookups\.current\.set\(item\.targetId, p\)/.test(studio) && /Promise\.race\(\[lookupLength\(item\)/.test(studio) && /setLearned\(\(prev\) => \(\{ \.\.\.prev, \[item\.targetId\]: sec \}\)\)/.test(studio) && /learned\[p\.id\]/.test(studio) && /e0 === start \+ PROVISIONAL_MIN/.test(studio), "placing a playlist with no stored length asks once (shared); the block then takes the music's own length, or the 5-minute stub until the answer comes");

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
