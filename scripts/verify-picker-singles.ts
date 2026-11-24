/**
 * THE SCHEDULING PICKER TELLS A SINGLE SONG FROM A PLAYLIST (owner 2026-11-24). A song saved from a search is a ONE-track playlist; the library shows it as a single, the Studio's music list showed it as a "Playlist · 1 song".
 * Now both use the same rule. Run: npx tsx scripts/verify-picker-singles.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isSinglePlaylist } from "../lib/schedule-picker-kind";
import { classifyLibraryEntityContract, type UnifiedSource } from "../lib/source-types";
import type { Playlist, PlaylistTrack } from "../lib/playlist-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const trk = (n: number): PlaylistTrack[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `Song ${i}`, type: "youtube", url: `https://www.youtube.com/watch?v=abc${i}` }));
const pl = (over: Partial<Playlist> & { n?: number }): Playlist => ({ id: "p1", name: "P", genre: "Mixed", type: "youtube", url: "https://www.youtube.com/watch?v=abc0", thumbnail: "", createdAt: "2026-11-24T00:00:00Z", tracks: trk(over.n ?? 1), ...over });

assert("P1 a song saved from a search (one track, a plain link) is a SINGLE", isSinglePlaylist(pl({ n: 1 })));
assert("P2 a playlist with several songs is a PLAYLIST", !isSinglePlaylist(pl({ n: 2 })) && !isSinglePlaylist(pl({ n: 25 })));
assert("P3 a playlist the user made (a local://user-playlist container) stays a PLAYLIST even with ONE song — and even with none", !isSinglePlaylist(pl({ n: 1, url: "local://user-playlist/p1" })) && !isSinglePlaylist(pl({ n: 0, url: "local://user-playlist/p1" })));
assert("P4 a link to a whole external playlist (YouTube list=…) is a PLAYLIST even when only one song was read from it", !isSinglePlaylist(pl({ n: 1, url: "https://www.youtube.com/playlist?list=PL123" })));
assert("P5 a playlist placed as ready_external is a PLAYLIST", !isSinglePlaylist(pl({ n: 1, libraryPlacement: "ready_external" })));

// the picker must agree with the LIBRARY for the very same stored row
const libShell = (p: Playlist): UnifiedSource => ({ id: p.id, title: p.name, genre: p.genre || "Mixed", cover: null, type: p.type, url: p.url, origin: "playlist", playlist: p, ...(p.libraryPlacement === "ready_external" ? { contentNodeKind: "external_playlist" as const } : {}) });
const samples = [pl({ n: 1 }), pl({ n: 2 }), pl({ n: 1, url: "local://user-playlist/p1" }), pl({ n: 0, url: "local://user-playlist/p1" }), pl({ n: 1, url: "https://www.youtube.com/playlist?list=PL123" }), pl({ n: 1, libraryPlacement: "ready_external" }), pl({ n: 1, type: "local", url: "C:/m/a.mp3" })];
assert("P6 the picker and the library give the SAME answer for every kind of stored row (single = item, playlist = collection)", samples.every((p) => isSinglePlaylist(p) === (classifyLibraryEntityContract(libShell(p)).entityKind === "item")));

const studio = rd("components/schedules-studio/schedules-studio.tsx");
assert("S1 the Studio's music list files a single under Songs ('Song'), a playlist under Playlists ('N songs'); what is scheduled stays the stored row (targetType PLAYLIST)", /const single = isSinglePlaylist\(p\);/.test(studio) && /targetType: "PLAYLIST", targetId: p\.id, name: p\.name, cover: [^\n]*kind: single \? "song" : "playlist", sub: single \? tr\("Song"\)/.test(studio));
assert("S2 the rule lives in ONE pure file that uses the library's own classifier and nothing else", /classifyLibraryEntityContract\(shell\)\.entityKind === "item"/.test(rd("lib/schedule-picker-kind.ts")) && /import \{ isSinglePlaylist \} from "@\/lib\/schedule-picker-kind";/.test(studio));
console.log(`\n${pass} passed, ${fail} failed`);
