/**
 * P0 Gate 2a (2026-10-08) — PARTIAL risk-reduction (renderer):
 *  (1) exact-track: a REAL playlist leaf (own playable URL) IS the clicked track — an omitted / defaulted / stale index
 *      never redirects it (Gate 1e regression: 1-arg callers clicked track K and got track 0);
 *  (2) loop: automatic URL steps follow the user's loop setting like the LOCAL natural end
 *      (lib/playback-provider.tsx computeSessionNextTrackIndex): EOF — "track" replays, "playlist" wraps, "off" stops;
 *      failure step — never retries the failing item.
 * Pure functions (lib/station-transport-routing.ts) + static pins on lib/device-player-context.tsx wiring.
 * Run: npx tsx scripts/verify-gate2a-exact-track-loop.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveExactUrlTarget, resolveUrlSessionStep } from "../lib/station-transport-routing";
import { expandPlaylistEntityToItems } from "../lib/syncbiz-playlist-queue";
import { computeSessionNextTrackIndex } from "../lib/playback-provider";
import type { UnifiedSource } from "../lib/source-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const N = 10;
const SHELL = "pl-gate2a";
const urlOf = (i: number) => `https://www.youtube.com/watch?v=g2a${String(i).padStart(8, "0")}`;
const playlist = { id: SHELL, name: "Gate 2a", type: "youtube", url: "", thumbnail: "", tracks: Array.from({ length: N }, (_, i) => ({ id: `t${i}`, name: `Track ${i}`, type: "youtube", url: urlOf(i) })) };
const shell = { id: SHELL, title: "Gate 2a", genre: "Mixed", cover: null, type: "youtube", url: "", origin: "playlist", playlist } as unknown as UnifiedSource;
const leaves = expandPlaylistEntityToItems(shell);
const tgt = (s: UnifiedSource, i?: number) => { const r = resolveExactUrlTarget(s, i); return "reject" in r ? `reject:${r.reject}` : `${r.source.id}#${r.trackIndex}|${r.source.url}`; };

// ── (1) exact track ──
assert("E1 real leaf r7, index OMITTED → r7 (its own url)", tgt(leaves[7]) === `${SHELL}:track:r7#7|${urlOf(7)}`);
assert("E2 real leaf r7, defaulted index 0 → r7 (never track 0)", tgt(leaves[7], 0) === `${SHELL}:track:r7#7|${urlOf(7)}`);
assert("E3 real leaf r7, stale index 3 → r7 (the clicked object wins; label corrected to 7)", tgt(leaves[7], 3) === `${SHELL}:track:r7#7|${urlOf(7)}`);
assert("E4 real leaf r0, index 0 → r0 (unchanged)", tgt(leaves[0], 0) === `${SHELL}:track:r0#0|${urlOf(0)}`);
assert("E5 borrowed leaf (no own url) r0 + index 5 → leaf r5 (Gate 1e incident shape, unchanged)", tgt({ ...leaves[0], url: "" } as UnifiedSource, 5) === `${SHELL}:track:r5#5|${urlOf(5)}`);
assert("E6 playlist shell + index 4 → leaf r4", tgt(shell, 4) === `${SHELL}:track:r4#4|${urlOf(4)}`);
assert("E7 playlist shell, index omitted → the shell itself at index 0 (existing payload rule)", tgt(shell) === `${SHELL}#0|`);
const mirrorOnly = { ...leaves[0], url: "", playlist: { id: SHELL, name: "x", tracks: playlist.tracks.map((t) => ({ id: t.id, name: t.name })) } } as unknown as UnifiedSource;
assert("E8 stand-in with mirrored tracks (no urls) + index 6 → REJECT (fail closed, Gate 1e unchanged)", tgt(mirrorOnly, 6).startsWith("reject:"));
const single = { id: "src-1", title: "Single", genre: "Mixed", cover: null, type: "youtube", url: urlOf(42), origin: "source" } as unknown as UnifiedSource;
assert("E9 non-playlist source → itself at index 0 (unchanged)", tgt(single) === `src-1#0|${urlOf(42)}`);

// ── (2) loop — as device-player-context passes it (automatic EOF / failure) ──
const step = (cur: number, loop: "playlist" | "track" | "off", automatic: "eof" | "failure") => {
  const r = resolveUrlSessionStep({
    sentLeaf: leaves[cur], mainSourceId: leaves[cur].id, mainTrackIndex: cur, mainSessionTrackCount: N, direction: "next",
    repeatMode: automatic === "failure" ? (loop === "off" ? "off" : "playlist") : loop,
    repeatCurrent: automatic === "eof",
  });
  return !r ? "null" : "noop" in r ? "noop" : String(r.trackIndex);
};
const local = (cur: number, loop: "playlist" | "track" | "off") => {
  const r = computeSessionNextTrackIndex(N, cur, false, loop, () => 0);
  return r.kind === "exhausted" ? "noop" : String(r.nextIndex);
};
for (const loop of ["playlist", "track", "off"] as const) {
  for (const cur of [3, N - 1]) {
    assert(`L ${loop} EOF at ${cur} → URL ${step(cur, loop, "eof")} == LOCAL ${local(cur, loop)} (parity with the accepted LOCAL natural end)`, step(cur, loop, "eof") === local(cur, loop));
  }
}
assert("L1 loop playlist, URL EOF at the LAST item → wraps to 0 (was: silence)", step(N - 1, "playlist", "eof") === "0");
assert("L2 loop off, URL EOF at the last item → stops (unchanged; the owner's explicit choice)", step(N - 1, "off", "eof") === "noop");
assert("L3 loop track, URL EOF → the SAME item again", step(4, "track", "eof") === "4");
assert("L4 failure step with loop track → the NEXT item (a failing item is never retried)", step(4, "track", "failure") === "5");
assert("L5 failure at the last item with loop playlist → item 0; with loop off → stop", step(N - 1, "playlist", "failure") === "0" && step(N - 1, "off", "failure") === "noop");
// manual NEXT unchanged ("track" acts as "playlist", no repeatCurrent)
const manual = resolveUrlSessionStep({ sentLeaf: leaves[4], mainSourceId: leaves[4].id, mainTrackIndex: 4, mainSessionTrackCount: N, direction: "next", repeatMode: "track" });
assert("L6 manual NEXT with loop track → next item (unchanged)", !!manual && !("noop" in manual) && manual.trackIndex === 5);

// ── static pins: the station wires exactly these rules ──
const dpc = readFileSync(path.join(__dirname, "..", "lib", "device-player-context.tsx"), "utf-8").replace(/\r\n/g, "\n");
assert("S1 playSourceOrSend keeps trackIndex OPTIONAL for the URL branch (LOCAL: ?? 0)", /\(source: UnifiedSource, trackIndex\?: number\) => \{/.test(dpc) && (dpc.match(/playSource\(source, trackIndex \?\? 0\)/g) ?? []).length === 2);
assert("S2 stepUrlSession: automatic failure never retries; EOF replays on loop track; manual uses the loop setting",
  /repeatMode: opts\?\.automatic === "failure" \? \(getRepeatMode\(\) === "off" \? "off" : "playlist"\) : getRepeatMode\(\),\n\s+repeatCurrent: opts\?\.automatic === "eof",/.test(dpc));
assert("S3 EOF + failure call sites use the automatic modes", /stepUrlSessionRef\.current\("next", \{ automatic: "eof" \}\)/.test(dpc) && /stepUrlSessionRef\.current\("next", \{ automatic: "failure", origin: "auto-failure", failures \}\)/.test(dpc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
