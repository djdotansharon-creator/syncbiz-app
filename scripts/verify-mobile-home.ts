/**
 * THE PHONE'S HOME (owner 2026-11-20): "why does the next song have a frame? and the branches?" + "give a home like Spotify, instead of the library".
 *  - the next song in the player and the branch rows have NO frame (a row like a library row; the branch that plays keeps the lifted surface of "what plays now");
 *  - the Library tab is now HOME: shelves of covers (what plays in your branches · played lately · your playlists · ready-made · your songs), "See all" → the whole list
 *    (`/mobile/library/all`, opened on the right chip), and the whole list is always one tap away.
 * Behavioural tests of the shelf rules + static guards of the wiring. Run: npx tsx scripts/verify-mobile-home.ts
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { buildShelves, parseRecent, pushRecent, recentKey, SHELF_MAX } from "../lib/mobile-home";
import type { UnifiedSource } from "../lib/source-types";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

// ── fakes ──
const track = (i: number) => ({ id: `t${i}`, name: `Song ${i}`, type: "youtube", url: `https://y.example/${i}`, cover: null });
const list = (id: string, n: number, opts: { ready?: boolean; at?: string } = {}): UnifiedSource =>
  ({
    id, title: `List ${id}`, genre: "Mixed", cover: null, type: "youtube", url: "", origin: "playlist",
    playlist: { id, name: `List ${id}`, tracks: Array.from({ length: n }, (_, i) => track(i)), createdAt: opts.at ?? "2026-01-01T00:00:00.000Z", libraryPlacement: opts.ready ? "ready_external" : undefined },
  }) as unknown as UnifiedSource;
const song = (id: string): UnifiedSource => ({ id, title: `Song ${id}`, genre: "Mixed", cover: null, type: "youtube", url: "https://y.example/x", origin: "source" }) as UnifiedSource;
const radio = (id: string): UnifiedSource => ({ id, title: `Radio ${id}`, genre: "Mixed", cover: null, type: "stream-url", url: "https://r.example/x", origin: "radio" }) as UnifiedSource;
const ids = (a: UnifiedSource[]) => a.map((s) => s.id);

// ── shelves ──
const lib = [
  list("old", 5, { at: "2026-01-01T00:00:00.000Z" }),
  list("new", 3, { at: "2026-05-01T00:00:00.000Z" }),
  list("ready1", 8, { ready: true, at: "2026-02-01T00:00:00.000Z" }),
  list("one", 1),
  list("bare", 0), // a list with no tracks of its own IS the single song it carries (getPlaylistTracks) — as the library rows count it
  song("s1"),
  radio("r1"),
];
const sh = buildShelves(lib, []);
assert("H1 'Your playlists' = the business's own lists with several songs, newest first (a one-song list and a ready-made one are not there)", ids(sh.mine).join() === "new,old");
assert("H2 'Ready-made' = the ready-made lists", ids(sh.ready).join() === "ready1");
assert("H3 'Your songs' = single songs and one-song lists that are not ready-made (a list with no tracks of its own is the one song it carries)", ids(sh.songs).sort().join() === "bare,one,s1");
assert("H4 radio stays out of the phone", ![...sh.mine, ...sh.ready, ...sh.songs, ...sh.recent].some((s) => s.id === "r1"));
assert("H5 a shelf carries at most SHELF_MAX covers (the rest is behind 'See all')", buildShelves(Array.from({ length: 30 }, (_, i) => list(`p${i}`, 4, { at: `2026-03-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z` })), []).mine.length === SHELF_MAX);
assert("H6 nothing in the library → every shelf empty (the screen shows 'Your library is empty')", Object.values(buildShelves([], ["playlist:x"])).every((a) => a.length === 0));

// ── played lately ──
assert("H7 the key of a song inside a playlist is its PLAYLIST's (a tapped song marks the list as played)", recentKey({ origin: "source", id: "pl-1:track:abc" }) === "playlist:pl-1" && recentKey({ origin: "source", id: "src-9" }) === "source:src-9");
assert("H8 pushRecent: newest first, once, capped", pushRecent(["a", "b", "c"], "c").join() === "c,a,b" && pushRecent(["a"], "z").join() === "z,a" && pushRecent(Array.from({ length: 20 }, (_, i) => `k${i}`), "n").length === SHELF_MAX);
assert("H9 parseRecent: garbage is 'nothing', non-strings and repeats are dropped", parseRecent("{") .length === 0 && parseRecent('{"a":1}').length === 0 && parseRecent(null).length === 0 && parseRecent('["a",1,"a","b",""]').join() === "a,b");
const withRecent = buildShelves(lib, ["playlist:old", "source:s1", "playlist:gone", "playlist:old", "radio:r1"]);
assert("H10 'Played lately' follows the remembered order, skips what is no longer in the library (and radio), no repeats", ids(withRecent.recent).join() === "old,s1");

// ── wiring ──
const ui = rd("components/vm/vm-ui.tsx");
const home = rd("components/vm/vm-home.tsx");
const css = rd("app/mobile-app.css");
const pageHome = rd("app/(app)/mobile/library/page.tsx");
const row = rd("components/vm/vm-source-row.tsx");
const phrases = rd("lib/i18n/phrases.ts");
assert("H11 the second tab is HOME (the old Library tab's address, a house icon) — Branches, Home, Search, Account", /\{ href: "\/mobile\/home", label: "Branches"[\s\S]{0,40}\},\s*\{ href: "\/mobile\/library", label: "Home", icon: <IconHome \/> \},\s*\{ href: "\/mobile\/search"/.test(ui));
assert("H12 Home is at the old Library address (every old link lands on it) and the whole list moved to /mobile/library/all", /<VmPage title=\{tr\("Home"\)\}>\s*<VmHome \/>/.test(pageHome) && existsSync(path.join(root, "app/(app)/mobile/library/all/page.tsx")));
const all = rd("app/(app)/mobile/library/all/page.tsx");
assert("H13 the whole list opens on the chip a shelf's 'See all' names (?cat=ready|mine) and has a way back to Home", /useSearchParams\(\)\?\.get\("cat"\)/.test(all) && /first === "ready" \|\| first === "mine"/.test(all) && /href="\/mobile\/library" className="vm-icobtn vm-back"/.test(all) && /<Suspense fallback=\{null\}>/.test(all));
assert("H14 the shelves: playing in your branches (→ Branches) · played lately · your playlists · ready-made · your songs; the whole list is always one tap away", /Playing in your branches[\s\S]{0,200}seeAll="\/mobile\/home"/.test(home) && /tr\("Played lately"\)/.test(home) && /seeAll="\/mobile\/library\/all\?cat=mine"/.test(home) && /seeAll="\/mobile\/library\/all\?cat=ready"/.test(home) && /href="\/mobile\/library\/all" className="vm-home-foot"/.test(home));
assert("H15 a cover does what a library row does: a song plays on the open branch, a list of several songs opens its songs, the song that plays opens the player", /multi \? \(\s*<Link href=\{`\/mobile\/library\/playlist\//.test(home) && /active \? ui\.openNowPlaying\(\) : send\.playNow\(source\)/.test(home));
assert("H16 what is sent to a branch is remembered on THIS phone (ids only) — in the one shared send function, after the guard passed", /fRef\.current\.playSource\(source\);\s*recordRecent\(source\);/.test(row) && !/localStorage/.test(rd("lib/mobile-home.ts")) && /vono-mobile-recent-v1/.test(rd("lib/mobile-recent.ts")));
assert("H17 the colour of what plays is a soft glow behind the top of the page (same colours as the player), and it never takes a tap", /\.vm-home-glow \{[^}]*pointer-events: none/.test(css) && /<div className="vm-home-glow" style=\{tone\}/.test(home));
assert("H18 shelves scroll sideways with logical properties only (Hebrew starts from the right)", /\.vm-shelf-row \{[^}]*overflow-x: auto/.test(css) && /\.vm-shelf-row \{[^}]*padding-inline: 20px/.test(css) && !/\.vm-(shelf|hc)[^{]*\{[^}]*(margin-left|margin-right|padding-left|padding-right|text-align: (left|right))/.test(css));
assert("H19 the new lines are translated", ["Home", "See all", "Played lately", "Playing in your branches", "Your playlists", "Ready-made lists", "Your songs", "Browse the whole library"].every((k) => new RegExp(`"${k}": "`).test(phrases)));

// ── NO FRAMES (owner 2026-11-20) ──
const rule = (sel: string) => { const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css); return m ? m[1]! : ""; };
assert("H20 the NEXT SONG has no frame: no background, no padding, no radius", rule(".vm-np-next") !== "" && !/background|border-radius|padding/.test(rule(".vm-np-next")));
assert("H21 a BRANCH row has no frame: transparent at rest (pressed = a soft wash like a library row); only the branch that plays keeps the lifted surface", /background: transparent/.test(rule(".vm-card")) && !/var\(--vm-card\)/.test(rule(".vm-card")) && /\.vm-card\[data-status="playing"\] \{ background: linear-gradient/.test(css));
assert("H22 the branch row's cover sits on the same edge as a library row's (16px): the row is 6px wider on each side and padded back 8px", /margin-inline: -6px/.test(rule(".vm-card")) && /padding: 6px 8px/.test(rule(".vm-card")));

console.log(`\n${pass} passed, ${fail} failed`);
