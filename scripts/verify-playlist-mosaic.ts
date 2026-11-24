/**
 * A PLAYLIST COVER MADE OF ITS FIRST FOUR SONGS (owner 2026-11-24, "like Spotify"). Pure rule + wiring. Run: npx tsx scripts/verify-playlist-mosaic.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { playlistMosaicCovers } from "../lib/playlist-mosaic";
import type { Playlist, PlaylistTrack } from "../lib/playlist-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const V = ["dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk", "JGwWNGJdvx8", "RgKAFK5djSk"];
const th = (v: string, q = "hqdefault") => `https://i.ytimg.com/vi/${v}/${q}.jpg`;
const trk = (i: number, withCover = true): PlaylistTrack => ({ id: `t${i}`, name: `S${i}`, type: "youtube", url: `https://www.youtube.com/watch?v=${V[i]}`, ...(withCover ? { cover: th(V[i]) } : {}) });
const pl = (n: number, thumb: string, over: Partial<Playlist> = {}): Playlist => ({ id: "p", name: "P", genre: "x", type: "youtube", url: "local://user-playlist/p", thumbnail: thumb, createdAt: "2026-11-24T00:00:00Z", tracks: Array.from({ length: n }, (_, i) => trk(i)), ...over });

assert("M1 four songs with pictures and the cover the app filled in (the first song's picture) → the first four pictures, in order", J(playlistMosaicCovers(pl(4, th(V[0])))) === J(V.slice(0, 4).map((v) => th(v))));
assert("M2 more than four songs → still the FIRST four", J(playlistMosaicCovers(pl(5, th(V[0])))) === J(V.slice(0, 4).map((v) => th(v))));
assert("M3 fewer than four pictures (3 songs, or 5 songs of which only 3 have art) → none, the single cover stays", playlistMosaicCovers(pl(3, th(V[0]))) === null && playlistMosaicCovers(pl(0, "")) === null);
assert("M4 no stored cover at all → the mosaic (nothing was chosen)", playlistMosaicCovers(pl(4, "")) !== null);
assert("M5 the stored cover is the same song's picture in ANOTHER size (mqdefault / maxresdefault) → still 'not chosen' → the mosaic", playlistMosaicCovers(pl(4, th(V[0], "mqdefault"))) !== null && playlistMosaicCovers(pl(4, th(V[2], "maxresdefault"))) !== null);
assert("M6 a cover somebody CHOSE (an address that is not one of the playlist's own songs' pictures, or an uploaded image) is kept → no mosaic", playlistMosaicCovers(pl(4, "https://example.com/mine.jpg")) === null && playlistMosaicCovers(pl(4, "data:image/jpeg;base64,AAAA")) === null);
assert("M7 a song with no picture is skipped: the four pictures come from the first four songs THAT HAVE one", (() => { const p = pl(5, ""); p.tracks = [trk(0), { ...trk(1), cover: undefined, url: "https://example.com/a.mp3", type: "stream-url" }, trk(2), trk(3), trk(4)]; return J(playlistMosaicCovers(p)) === J([V[0], V[2], V[3], V[4]].map((v) => th(v))); })());
function J(x: unknown): string { return JSON.stringify(x); }

const card = rd("components/source-card-unified.tsx");
assert("W1 the library card draws the mosaic only for a real playlist (a collection) and keeps the single picture for everything else", /source\.origin === "playlist" && source\.playlist && classifyLibraryEntityContract\(source\)\.entityKind === "collection" \? playlistMosaicCovers\(source\.playlist\) : null/.test(card) && /\{mosaic \? \(\s*<PlaylistMosaic urls=\{mosaic\}/.test(card) && /<HydrationSafeImage src=\{cardCover\}/.test(card));
const lib = rd("components/sources-manager.tsx");
const alb = rd("components/playlist-workspace-panel.tsx");
assert("W2 the open playlist's header takes the same mosaic (a real playlist only) and falls back to the cover / the initial", /mosaic: mosaicPlaylist \? playlistMosaicCovers\(mosaicPlaylist\) : null/.test(lib) && /mosaic=\{collectionOpenContext\.mosaic\}/.test(lib) && /\{mosaic \? <PlaylistMosaic urls=\{mosaic\} \/> : cover \?/.test(alb));
const css = rd("app/globals.css");
assert("W3 the quarters sit in a 2 × 2 grid and the album header's own 'every picture is absolute' rule does not pile them up", /\.sb-mosaic \{ display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;/.test(css) && /\.sb-alb-cover \.sb-mosaic img \{ position: static;/.test(css));
console.log(`\n${pass} passed, ${fail} failed`);
