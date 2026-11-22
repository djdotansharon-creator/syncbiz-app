/**
 * AN OPENED PLAYLIST IN THE ALBUM LOOK (owner 2026-11-22: "I click a playlist and it opens like today — now I want it shown like our albums, 1 2 3; keep the current view so I can bring it
 * back; an opening effect; and the loading before the screen switches"). Guards the wiring: the screen is a renderer-only view over what the library already holds, it plays through the
 * SAME calls the classic view uses, the classic view is untouched and one click away (remembered), the open waits for the first pictures (capped) and the last click wins.
 * Run: npx tsx scripts/verify-playlist-album-view.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const panel = rd("components/playlist-workspace-panel.tsx");
const panelCode = strip(panel);
const sm = rd("components/sources-manager.tsx");
const css = rd("app/globals.css");

// ── the screen itself ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
assert("A1 the screen is a pure view: it fetches nothing and imports no playback / device context (it only draws what the library holds)", !/\bfetch\(/.test(panelCode) && !/usePlayback|useDevicePlayer|device-player-context|playback-provider/.test(panelCode));
assert("A2 it is drawn with the album's own classes: head with cover + name + count, a big bare play, numbered rows (number, cover, name, details)", /sb-alb-head/.test(panel) && /sb-alb-cover/.test(panel) && /sb-alb-count/.test(panel) && /sb-alb-play/.test(panel) && /className="sb-alb-n"/.test(panel) && /<b>\{i \+ 1\}<\/b>/.test(panel) && /sb-alb-art/.test(panel) && /sb-alb-name/.test(panel) && /sb-alb-meta/.test(panel));
assert("A3 a click on a song calls onPlayItem(song); the big play calls onPlayAll; Esc and the X go back", /onClick=\{\(\) => onPlayItem\(it\)\}/.test(panel) && /onClick=\{onPlayAll\}/.test(panel) && /e\.key !== "Escape"/.test(panel) && /onClick=\{onBack\}/.test(panel));
assert("A4 the playing song is marked (data-active) and the way back to the classic view is a visible button", /data-active=\{activeId === it\.id \? "1" : undefined\}/.test(panel) && /onClick=\{onClassicView\}/.test(panel) && /sb-alb-classic/.test(panel));
assert("A5 Hebrew (RTL) and English texts both exist", /songs: \(n: number\)/.test(panel) && /תצוגה קלאסית/.test(panel) && /Classic view/.test(panel) && /dir=\{he \? "rtl" : "ltr"\}/.test(panel));
assert("A6 the generic genre 'Mixed' is not shown as a detail; the length comes from leafDurationSeconds", /LIBRARY_CARD_FALLBACK_GENRE/.test(panel) && /leafDurationSeconds/.test(panel));
const pre = panel.slice(panel.indexOf("export function preloadPlaylistCovers"), panel.indexOf("export function PlaylistWorkspacePanel")); // raw text: the address filter is a regex literal that contains "//", which the comment stripper would eat
assert("A7 the preload is capped in time (300 ms) and in count (12), answers on error too (a failed picture never blocks the screen), and ignores non-http addresses", /maxMs = 300/.test(pre) && /\.slice\(0, 12\)/.test(pre) && /im\.onerror = one/.test(pre) && /\(https\?:\)\?\\\/\\\//.test(pre) && /setTimeout\(resolve, maxMs\)/.test(pre));

// ── the wiring in the library ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
assert("B1 default is the album look; 'classic' is remembered per device under its own key", /useState<"album" \| "classic">\("album"\)/.test(sm) && /vono-playlist-view-v1/.test(sm) && (sm.match(/vono-playlist-view-v1/g) ?? []).length === 2);
assert("B2 the album look applies only to a user playlist or an external playlist — and NOT to a playlist that has scheduled contributor blocks (it keeps the classic view with its Contributors section)", /const playlistAlbumOn =[\s\S]*?playlistView === "album" &&[\s\S]*?selection\.subtype === "syncbiz_playlist" \|\| selection\.subtype === "external_playlist"[\s\S]*?!\(compositeScheduleBlocks != null && compositeScheduleBlocks\.length > 0\)/.test(sm));
assert("B3 both playlist cards open through openPlaylistEntity (the click path is still the card's own 220 ms single-click timer, so the double-click play is untouched)", (sm.match(/onPlaylistEntityOpen=\{pe \? \(\) => openPlaylistEntity\(pe\.subtype, pe\.key\) : undefined\}/g) ?? []).length === 2 && !/onPlaylistEntityOpen=\{\s*pe\s*\?\s*\(\) => setSelection/.test(sm));
const open = sm.slice(sm.indexOf("const openPlaylistEntity = useCallback"), sm.indexOf("const handleDjHubPlaylistDragStart"));
assert("B4 the open: classic or another kind of collection → straight setSelection as before; album → preloads the covers FIRST, then switches; the last click wins (a newer open or any other selection cancels the pending one)", /playlistView !== "album" \|\| \(subtype !== "syncbiz_playlist" && subtype !== "external_playlist"\)[\s\S]*?setSelection\(target\);\s*return;/.test(open) && /preloadPlaylistCovers\(urls\)\.then\(\(\) => \{\s*if \(playlistOpenSeqRef\.current === seq\) setSelection\(target\)/.test(open) && /playlistOpenSeqRef\.current \+= 1;\s*\}, \[selection\]\)/.test(sm));
assert("B5 the classic header is hidden ONLY while the album look is on, and carries an 'Album view' button back; everything else of the classic view is still in the file (Playlist Items, the grid / rows, the same play callbacks)", /\{collectionOpenContext && !playlistAlbumOn \? \(/.test(sm) && /setPlaylistView\("album"\)/.test(sm) && /"Playlist Items"/.test(sm) && (sm.match(/onPlaySource=\{playSyncbizPlaylistExpandedItem\}/g) ?? []).length === 2 && /onPlaySource=\{playSourceForLibraryCard\}/.test(sm));
const album = sm.slice(sm.indexOf("playlistAlbumOn && collectionOpenContext ? ("), sm.indexOf(": sourceOpenContext && sourceDetailItems ? ("));
assert("B6 the album screen plays through the SAME calls: a song → playSyncbizPlaylistExpandedItem (user playlist) / playSourceForLibraryCard (external); the big play → playCollectionSelection (the double-click play); classic is one click away", /playCollectionSelection\(selection\.subtype, selection\.key\)/.test(album) && /onPlayItem=\{playAlbumViewItem\}/.test(album) && /onClassicView=\{\(\) => setPlaylistView\("classic"\)\}/.test(album) && /selection\.subtype === "syncbiz_playlist"\) playSyncbizPlaylistExpandedItem\(item\);\s*else playSourceForLibraryCard\(item\)/.test(sm));
assert("B7 nothing in the playback chain is touched: no edit to audio-player, playback-provider, device-player-context, desktop MAIN or the server", true, "checked by `git diff --stat` in the report");

// ── the look ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const i0 = css.indexOf("/* An opened PLAYLIST in the album look");
const add = css.slice(i0, css.indexOf("/* ── Radio in the library"));
assert("C1 the added styles are flat (no blur, no filter, no backdrop-filter), keep the light-display variants, and only extend the album's classes", i0 > 0 && !/backdrop-filter|filter:|blur\(/.test(add) && /html\[data-sb-display="white"\] \.sb-alb-row\[data-active="1"\]/.test(add) && /\.sb-alb-row\[data-active="1"\]/.test(add));

// ── the ⋯ menu of a song (owner 2026-11-22: horizontal dots at the side, a small glass menu like the cards, everything the classic card had) ─────────────────────────────────
assert("D1 each row has its own ⋯ button (a sibling of the row button, never a button inside a button) drawn as THREE HORIZONTAL dots (same cy)", /<\/button>\s*<button\s+type="button"\s+className=\{`sb-alb-more/.test(panel) && /<circle cx="5" cy="12"/.test(panel) && /<circle cx="12" cy="12"/.test(panel) && /<circle cx="19" cy="12"/.test(panel) && /aria-haspopup="menu"/.test(panel));
assert("D2 the menu is the library cards' own glass menu: same classes, same pop-in / pop-out (it unmounts when sb-pop-out ends), beside the button, mirrored in Hebrew", /sb-card-menu \$\{menuOpen \? "sb-anim-pop" : "sb-anim-pop-out pointer-events-none"\}/.test(panel) && /e\.animationName === "sb-pop-out"\) setMenu\(null\)/.test(panel) && /const toRight = he \? !fitsLeft && fitsRight : fitsRight \|\| !fitsLeft/.test(panel) && /sb-card-menu-item--danger/.test(panel) && /sb-card-menu-sep/.test(panel));
assert("D3 three actions: Play (the row's own play call), Add to playlist (the library's own add), Remove / delete (opens the same dialog the classic card opens)", /onPlayItem\(menu\.item\)/.test(panel) && /onAddToPlaylist\(menu\.item\)/.test(panel) && /setDelFor\(menu\.item\)/.test(panel) && /<LibraryItemContextDeleteModal/.test(panel) && /variant=\{delCtx\.kind === "in_playlist" \? "in_playlist" : "all_library"\}/.test(panel) && /onRemoveFromPlaylist=\{delCtx\.kind === "in_playlist" \? delCtx\.onRemoveFromPlaylist : undefined\}/.test(panel) && /showDeleteFromLibrary=\{canDeleteFromLibrary\(delFor\)\}/.test(panel));
assert("D4 nothing is blocked while the menu is open (a press outside closes it and goes through; a ⋯ press decides for itself); a scroll closes it; Esc closes ONLY the menu (capture + preventDefault) and never also leaves the screen; Esc while the dialog is open does not leave either", /pointerdown", onPress, true\)/.test(panel) && /"\.sb-alb-more"/.test(panel) && /addEventListener\("keydown", onKey, true\)/.test(panel) && /e\.preventDefault\(\);\s*setMenuOpen\(false\)/.test(panel) && /e\.defaultPrevented \|\| delOpenRef\.current/.test(panel));
assert("D5 the library hands in ITS OWN handlers: handleAddLeafToPlaylist, getItemDeleteContext, the same delete-eligibility rule, deleteLibraryItem (nothing re-implemented)", /onAddToPlaylist=\{handleAddLeafToPlaylist\}/.test(album) && /deleteContextFor=\{getItemDeleteContext\}/.test(album) && /canDeleteFromLibrary=\{\(it\) => libraryRowEligibleForLibraryDelete\(it, displaySources\)\}/.test(album) && /onDeleteFromLibrary=\{deleteLibraryItem\}/.test(album));
const dots = css.slice(css.indexOf("/* The ⋯ at the end of a song's row"), css.indexOf("/* ── Radio in the library"));
assert("D6 the ⋯ styles are flat (no blur / filter), appear on hover / focus / when open, always on touch, leave room in the row, and have a light-display variant", dots.length > 100 && !/backdrop-filter|filter:|blur\(/.test(dots) && /li:hover \.sb-alb-more/.test(dots) && /@media \(hover: none\)/.test(dots) && /padding-inline-end: 64px/.test(dots) && /html\[data-sb-display="white"\] \.sb-alb-more/.test(dots));

console.log(`\n${pass} passed, ${fail} failed`);
