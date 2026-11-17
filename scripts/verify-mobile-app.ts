/**
 * THE PHONE APP (owner 2026-11-16: "a remote for the businesses — see what plays in each branch, control it all, premium like Apple Music; no local player for now").
 * Static guards for the invariants (the behaviour itself — round trips to a branch's station, recovery after the socket server restarted, Hebrew / English screens —
 * was run in a real browser against the local WS server).  Run: npx tsx scripts/verify-mobile-app.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else fail++;
}

const fleet = rd("lib/mobile-fleet.tsx");
const vmFiles = readdirSync(path.join(root, "components/vm")).filter((f) => /\.tsx?$/.test(f));
const vm = vmFiles.map((f) => rd(`components/vm/${f}`)).join("\n");

assert("M1 the phone never plays audio itself: the branch layer and every phone-app component stay clear of the local player (no PlaybackProvider, no device player, no <audio> / <video>)", !/usePlayback|playback-provider|device-player-context|useDevicePlayer|playSourceOrSend|<audio|<video|new Audio\(/.test(fleet + vm));
assert("M2 every command goes to ONE branch's station by its routing id (sendCommandTo), and only while that station is online", /ownerRef\.current\.sendCommandTo\(t, command, payload\)/.test(fleet) && /return s && s\.online && s\.rawId \? s\.rawId : null;/.test(fleet));
assert("M3 the phone registers no player and no MASTER: the branch layer uses only the owner (control) socket", /useRemoteOwner\(\)/.test(fleet) && !/useRemoteController|role: "device"/.test(fleet));
assert("M4 the same one-pending-transition rules as the old controller layer (a 2nd NEXT while one loads is ignored, the audible song stays shown, Loading… from the shared intent)", /decideUserCommand/.test(fleet) && /isBlocking\(transitionRef\.current\)\) return;/.test(fleet) && /displayPlaybackState\(/.test(fleet) && /transitionLabel\(/.test(fleet));
assert("M5 the automatic branch choice waits for the live list and follows the live branch; a branch the person picked (or saved) is never replaced", /autoPicked\.current = true;/.test(fleet) && /autoPicked\.current = false; \/\/ the person chose it/.test(fleet) && /if \(!liveKnown && !gaveUp\) return;/.test(fleet));

const layout = rd("app/(app)/mobile/layout.tsx");
assert("M6 the phone shell mounts ONE live connection (MobileFleetProvider) and no second controller socket", /<MobileFleetProvider>/.test(layout) && !/StationControllerProvider/.test(layout));
const ui = rd("components/vm/vm-ui.tsx");
assert("M7 an old 'Player' choice saved on a phone is put back to Controller by the shell", /if \(mobileRole !== "controller"\) setMobileRole\("controller"\);/.test(ui));

const ws = rd("lib/remote-control/ws-client.ts");
const owner = ws.slice(ws.indexOf("export function useRemoteOwner()"));
assert("M8 the OWNER socket comes back on its own (backoff, forever) after a server restart / network loss — before, only focus / visibility brought it back and an open phone never got those", /createReconnectScheduler\(\{/.test(owner) && /if \(!intentionalClose\) reconnectSchedulerRef\.current\?\.scheduleRetry\(\)/.test(owner) && /reconnectSchedulerRef\.current\?\.connected\(\)/.test(owner) && /window\.addEventListener\("online", onFocus\)/.test(owner));
assert("M9 a signed-out person (token 401) is not retried in a loop; a network blip while asking for the token is", /tokenUnauthorizedRef\.current = true;/.test(owner) && /else if \(!tokenUnauthorizedRef\.current\) reconnectSchedulerRef\.current\?\.scheduleRetry\(\)/.test(owner));
assert("M10 sendCommandTo may carry the commands' payloads (type widening only — the body already forwarded it)", /payload\?: \{ url\?: string; source\?: unknown; position\?: number; volume\?: number; value\?: boolean; trackIndex\?: number; mode\?: "playlist" \| "track" \| "off" \},/.test(owner));

const ap = rd("components/audio-player.tsx");
assert("M11 no muted video clip streams on the phone routes (/mobile) — data, battery, decode for a screen nobody sees (display-only; audio untouched)", /!pathname\?\.startsWith\("\/mobile"\) \? \(/.test(ap));

const css = rd("app/mobile-app.css");
const bad: string[] = [];
for (const raw of css.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")) {
  const m = /^([^\s@}{][^{]*)\{/.exec(raw);
  if (!m) continue;
  const parts: string[] = []; let depth = 0, cur = "";
  for (const ch of m[1]!) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch; }
  parts.push(cur);
  for (const sel of parts.map((x) => x.trim()).filter(Boolean)) {
    if (!/^(\.vm|:where\(\.vm\)|html\[data-sb-fx="lite"\] \.vm|\[dir="rtl"\] \.vm|\.vm-)/.test(sel) && !/^(from|to|\d+%|0%|45%|70%|88%|100%|12%)/.test(sel)) bad.push(sel);
  }
}
assert(`M12 the phone app's CSS is scoped under .vm — nothing leaks onto the desktop screens${bad.length ? " (" + bad.slice(0, 3).join(" | ") + ")" : ""}`, bad.length === 0);
assert("M13 weak graphics: glass becomes solid in the lite look (tab bar, mini-player, page bar)", /html\[data-sb-fx="lite"\] \.vm-tabs \{ background: #0f0f12; \}/.test(css) && /html\[data-sb-fx="lite"\] \.vm-mini \{ background: #25252b; \}/.test(css) && /html\[data-sb-fx="lite"\] \.vm-bar\[data-on\] \{ background: #0a0a0c; \}/.test(css));
assert("M14 the layout is right-to-left safe: logical properties for the sides, transport and sliders stay left-to-right like Apple Music", /\.vm-transport \{ direction: ltr;/.test(css) && /\.vm-slider \{[^}]*direction: ltr;/.test(css) && !/margin-left|margin-right|padding-left|padding-right|\bleft:|\bright:/.test(css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/inset-inline[^;]*;/g, "").replace(/\.vm-switch::after[^}]*\}/g, "")));

// every phrase the phone app writes through tr("…") has a Hebrew line
const ph = rd("lib/i18n/phrases.ts");
const have = new Set([...ph.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)].map((m) => m[1]!.replace(/\\"/g, '"')));
const files = [...vmFiles.map((f) => `components/vm/${f}`), "lib/mobile-fleet.tsx", "app/(app)/mobile/home/page.tsx", "app/(app)/mobile/branch/[id]/page.tsx", "app/(app)/mobile/library/page.tsx", "app/(app)/mobile/library/playlist/[id]/page.tsx", "app/(app)/mobile/search/page.tsx", "app/(app)/mobile/account/page.tsx", "app/(app)/mobile/scheduling/page.tsx"];
const missing = new Set<string>();
for (const f of files) for (const m of rd(f).matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) if (!have.has(m[1]!.replace(/\\"/g, '"'))) missing.add(m[1]!);
assert(`M15 every sentence of the phone app has its Hebrew${missing.size ? " (missing: " + [...missing].slice(0, 4).join(" | ") + ")" : ""}`, missing.size === 0);

const jingles = rd("components/mobile/mobile-jingles.tsx");
const sched = rd("app/(app)/mobile/scheduling/page.tsx");
assert("M16 a jingle pad plays on the OPEN branch (not on the branch the account is signed in to), and Scheduling lists the OPEN branch's schedule", /fleet\.interrupt\(pad\.url\)/.test(jingles) && !/deviceCtx\.sendCommandToMaster/.test(jingles) && /\/api\/schedules\?branchId=\$\{encodeURIComponent\(branchId\)\}/.test(sched));
assert("M17 identify-a-song / Shazam import send the song to the OPEN branch through `route` (the old ladder stays for the desktop-era callers)", /if \(route\) route\.play\(u\)/.test(rd("components/mobile/mobile-listen-identify.tsx")) && /if \(route\) route\.queue\(u\)/.test(rd("components/mobile/mobile-shazam-import.tsx")) && /route=\{route\}/.test(rd("app/(app)/mobile/search/page.tsx")));
const row = rd("components/vm/vm-source-row.tsx");
// (owner 2026-11-17, replaces the 2026-11-16 rule "a tap only opens a row": tapping a SONG plays it on the open branch; the slip-of-the-thumb safety is now the shared guard + the playing song only opening the player)
assert("M18 a library row: tapping a song PLAYS it on the open branch through the shared guard (branch open + online, else the picker / the offline toast); a playlist of several songs OPENS instead; the song that plays opens the player; no round + / play buttons — one ⋯ menu", /onClick=\{\(\) => \(active \? ui\.openNowPlaying\(\) : send\.playNow\(source\)\)\}/.test(row) && /<Link href=\{href!\} className="vm-src-main">/.test(row) && /const multi = isPlaylist && count !== 1 && !!href;/.test(row) && /if \(!cur\.canControl\) \{/.test(row) && /className="vm-more"/.test(row) && !/vm-add/.test(row + rd("app/mobile-app.css")));
// round 2 (2026-11-17)
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const circleRule = (sel: string) => (new RegExp(`^${sel.replace(/[.\[\]-]/g, "\\$&")} \\{[^}]*\\}`, "m").exec(cssNoComments) ?? [""])[0];
assert("M21 no circle around play / pause: the card's button, the player's big play and the mini-player's buttons carry no background, border or round fill", !/background|border/.test(circleRule(".vm-pp")) && !/background|border/.test(circleRule(".vm-tbtn")) && !/background|border/.test(circleRule(".vm-tbtn--play")) && !/background:/.test(circleRule(".vm-icobtn:active")));
assert("M22 the player's background is the colour of the song: the sheet, the mini-player and a branch's player read the cover's colour (a name-coloured fallback), glide on a change, and are a solid tint on weak graphics", /\.vm-sheet--np \{ background: linear-gradient\(180deg, var\(--vm-t1\)/.test(css) && /@property --vm-t1/.test(css) && /html\[data-sb-fx="lite"\] \.vm-sheet--np \{ background: var\(--vm-t2\); \}/.test(css) && /export function useNowTone\(\)/.test(rd("components/vm/vm-tone.ts")) && /toneFromPixels/.test(rd("components/vm/vm-tone.ts")) && /useNowTone\(\)/.test(ui) && /data-tone=""/.test(rd("components/vm/vm-now-playing.tsx")));
const frames = cssNoComments.split("\n").filter((l) => /(^|[\s;{])border(-top|-bottom|-inline[a-z-]*|-left|-right)?:\s*[0-9.]+(px)?\s+solid|inset 0 0 0 [0-9.]+px|\boutline:\s*[0-9.]+px/.test(l) && !/:focus-visible/.test(l));
assert(`M23 fewer frames: the phone app's own CSS draws no border, no inset ring and no outline (only the keyboard focus ring)${frames.length ? " (" + frames[0]!.slice(0, 60) + ")" : ""}`, frames.length === 0);
const plan = rd("app/(app)/mobile/scheduling/page.tsx");
assert("M24 Today's plan is built from the Schedules Studio's own scenes (buildDayScenes / nowAndNext), has the branch's schedule switch, and no framed cards, status pills or UTC chips", /buildDayScenes\(/.test(plan) && /nowAndNext\(/.test(plan) && /<VmScheduleSwitchLine/.test(plan) && !/border|rounded-|StatusPill|timezone/.test(plan));
assert("M19 the old Remote tab is a redirect to the Branches tab (saved links keep working)", /redirect\("\/mobile\/home"\)/.test(rd("app/(app)/mobile/remote/page.tsx")));
assert("M20 nothing of the desktop MAIN, the installer or the MASTER designation is touched by the phone app", !/from "[^"]*(desktop\/|designation)/.test(fleet + vm));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
