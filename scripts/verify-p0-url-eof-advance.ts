/**
 * P0 (2026-10-07) — URL session natural-EOF auto-advance on the designated station (RENDERER ONLY).
 *
 * Drives the REAL desktop PlaybackOrchestrator + MpvManager event handling (synthetic MPV IPC events, no MPV process),
 * the REAL MAIN session builder (MockPlaybackSession), the REAL playlist expansion + URL session step resolver and the
 * REAL EOF tracker (lib/url-eof-advance.ts), wired in the same order as lib/device-player-context.tsx (static pins).
 * Run: npx tsx scripts/verify-p0-url-eof-advance.ts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { resolveUrlSessionStep } from "../lib/station-transport-routing";
import { unifiedSourceToPayload } from "../lib/remote-control/source-to-payload";
import { expandPlaylistEntityToItems } from "../lib/syncbiz-playlist-queue";
import { initialUrlEofState, observeUrlEof, disarmUrlEof, MAIN_WS_ATTEMPT_BASE, type UrlEofState } from "../lib/url-eof-advance";
import type { UnifiedSource } from "../lib/source-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const ROOT = path.join(__dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf-8").replace(/\r\n/g, "\n");

// ── fixture: a 10-item URL playlist ─────────────────────────────────────────────────────────────────────────
const N = 10;
const shell = {
  id: "pl-url", title: "Evening", genre: "", cover: null, type: "youtube", url: "https://www.youtube.com/watch?v=v0", origin: "playlist",
  playlist: { id: "pl-url", name: "Evening", type: "youtube", url: "https://www.youtube.com/watch?v=v0",
    tracks: Array.from({ length: N }, (_, i) => ({ id: `t${i}`, name: `Track ${i}`, type: "youtube", url: `https://www.youtube.com/watch?v=v${i}`, cover: "" })) },
} as unknown as UnifiedSource;
const leaves = expandPlaylistEntityToItems(shell);

// ── real desktop modules through a computed path (the app build host has no electron) ───────────────────────
type MusicStatus = { status: string; attemptId: number; position: number; duration: number; lastError: string | null; engineReady: boolean };
type Deck = { handleEvent: (m: Record<string, unknown>) => void };
type Orch = {
  playMusic(u: string, id: number): void; playMusicCrossfade(u: string, f: number, id: number): void; stopMusic(): void; kill(): void;
  getState(): { music: MusicStatus }; musicDeckA: Deck; musicDeckB: Deck; activeMusicDeck: "A" | "B"; musicStA: unknown;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PlaybackOrchestrator } = require(path.join(ROOT, "desktop", "src", "main", "playback-orchestrator")) as { PlaybackOrchestrator: new () => Orch };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MockPlaybackSession } = require(path.join(ROOT, "desktop", "src", "playback-agent", "mock-playback-session")) as {
  MockPlaybackSession: new () => { setStationSession(i: Record<string, unknown>): void; getState(): { currentSource?: { id?: string } | null; currentTrackIndex: number; sessionTracks?: unknown[] } };
};

/** Station harness: MAIN (orchestrator + session) + the co-located renderer's URL-session wiring. */
function station(startIndex: number) {
  const orch = new PlaybackOrchestrator();
  // No MPV process in this harness: mark both decks' IPC as connected (what a running MAIN reports).
  for (const d of [orch.musicDeckA, orch.musicDeckB]) (d as unknown as { st: { engineReady: boolean } }).st.engineReady = true;
  const main = new MockPlaybackSession();
  let seq = 0;
  const loads: { index: number; attemptId: number; mode: string }[] = [];
  let lastSentUrlLeaf: UnifiedSource | null = null;
  let localSessionOwned = false;
  let eof: UrlEofState = initialUrlEofState();
  // MAIN PLAY_SOURCE handling (same order as device-ws-manager.ts: session metadata, then a fresh MAIN attempt)
  const mainPlaySource = (leaf: UnifiedSource, trackIndex: number) => {
    const p = unifiedSourceToPayload(leaf) as { id: string; title?: string; cover?: string | null; type?: string; url?: string; playlistId?: string; sessionTracks?: { id: string; title: string }[] };
    main.setStationSession({
      id: p.id, title: p.title ?? "", cover: p.cover ?? null, origin: "playlist", sourceType: p.type, url: p.url, trackIndex,
      sessionTitle: p.title ?? null, sessionPlaylistId: p.playlistId ?? null,
      sessionTracks: (p.sessionTracks ?? []).map((t) => ({ id: String(t.id), title: t.title ?? "", cover: null })),
    });
    const id = MAIN_WS_ATTEMPT_BASE + ++seq;
    const active = orch.getState().music.status;
    if (active === "playing" || active === "paused") { orch.playMusicCrossfade(leaf.url, 1, id); loads.push({ index: trackIndex, attemptId: id, mode: "crossfade" }); }
    else { orch.playMusic(leaf.url, id); loads.push({ index: trackIndex, attemptId: id, mode: "cold" }); }
  };
  // renderer: select (playSourceOrSend URL branch)
  const select = (i: number) => { localSessionOwned = false; lastSentUrlLeaf = leaves[i]; eof = disarmUrlEof(eof); mainPlaySource(leaves[i], i); };
  // renderer: stepUrlSession (same body as lib/device-player-context.tsx)
  const step = (direction: "next" | "prev", noWrap = false): boolean => {
    if (localSessionOwned) return false;
    const ms = main.getState();
    const st = resolveUrlSessionStep({ sentLeaf: lastSentUrlLeaf, mainSourceId: ms.currentSource?.id ?? null, mainTrackIndex: ms.currentTrackIndex, mainSessionTrackCount: ms.sessionTracks?.length ?? null, direction, repeatMode: noWrap ? "off" : "playlist" });
    if (!st) return false;
    eof = disarmUrlEof(eof);
    if ("noop" in st) return true;
    lastSentUrlLeaf = st.leaf;
    mainPlaySource(st.leaf, st.trackIndex);
    return true;
  };
  let advances = 0;
  // renderer: desktop.onStatus observer (same mapping as lib/device-player-context.tsx)
  const observe = (m: MusicStatus = orch.getState().music) => {
    const urlSessionActive = !localSessionOwned && !!lastSentUrlLeaf?.playlist && lastSentUrlLeaf.type !== "local";
    const r = observeUrlEof(eof, { status: m.status, attemptId: m.attemptId, position: m.position, duration: m.duration, lastError: m.lastError, engineReady: m.engineReady !== false }, urlSessionActive);
    eof = r.state;
    if (r.advance) { advances++; step("next", true); }
    return r;
  };
  const deck = (id: "A" | "B") => (id === "A" ? orch.musicDeckA : orch.musicDeckB);
  // MPV events on the deck that holds the CURRENT attempt
  const curDeck = () => deck(((orch as unknown as { currentAttemptDeck: "A" | "B" }).currentAttemptDeck));
  const startPlaying = (d = curDeck()) => {
    d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 240 });
    d.handleEvent({ event: "property-change", name: "time-pos", data: 1.5 }); d.handleEvent({ event: "property-change", name: "core-idle", data: false });
    d.handleEvent({ event: "property-change", name: "time-pos", data: 2.5 });
  };
  const endFile = (reason: string, d = curDeck(), extra: Record<string, unknown> = {}) => d.handleEvent({ event: "end-file", reason, ...extra });
  select(startIndex);
  return {
    orch, main, loads, observe, step, startPlaying, endFile, deck, curDeck,
    get advances() { return advances; }, get eof() { return eof; },
    setLocalOwned(v: boolean) { localSessionOwned = v; },
  };
}

(async () => {
  // 1. index 7 EOF → advances once to 8
  {
    const s = station(7);
    s.startPlaying(); s.observe();
    assert("1a URL item 7 playing (MAIN attempt armed)", s.eof.armedAttemptId === s.loads[0].attemptId, JSON.stringify(s.eof));
    s.endFile("eof"); s.observe();
    assert("1b EOF of item 7 → exactly ONE advance → PLAY_SOURCE item 8", s.advances === 1 && s.loads.length === 2 && s.loads[1].index === 8);
    assert("1c MAIN session index becomes 8 (not 7, not 0)", s.main.getState().currentTrackIndex === 8);
    assert("1d new load is a fresh MAIN attempt, cold start from the idle deck (no LOCAL)", s.loads[1].attemptId > s.loads[0].attemptId && s.loads[1].mode === "cold" && !/local/.test(String(leaves[8].type)));
    // 2. same EOF event delivered twice (same snapshot replayed)
    s.observe({ status: "idle", attemptId: s.loads[0].attemptId, position: 0, duration: 240, lastError: null, engineReady: true });
    s.observe();
    assert("2 duplicate EOF delivery → still ONE advance / ONE load", s.advances === 1 && s.loads.length === 2);
    // 3. stale EOF from the previous attempt after B started
    s.startPlaying(); s.observe();
    s.observe({ status: "idle", attemptId: s.loads[0].attemptId, position: 0, duration: 240, lastError: null, engineReady: true });
    assert("3 stale EOF of the previous attempt → ignored (B keeps playing, no load)", s.advances === 1 && s.loads.length === 2 && s.orch.getState().music.status === "playing");
    s.orch.kill();
  }
  // 4. EOF from the OUTGOING crossfade deck is ignored
  {
    const s = station(3);
    s.startPlaying(); s.observe();
    const outgoing = s.curDeck();
    s.step("next"); // manual NEXT → crossfade to item 4 (disarms)
    const before = s.loads.length;
    s.endFile("eof", outgoing); s.observe(); // outgoing deck reaches its natural end mid-crossfade
    assert("4a crossfade in flight: outgoing deck EOF publishes the INCOMING attempt (pending) — no advance", s.advances === 0 && s.loads.length === before && s.orch.getState().music.attemptId === s.loads[1].attemptId);
    assert("4b manual NEXT went to item 4 via crossfade (single load)", s.loads.length === 2 && s.loads[1].index === 4 && s.loads[1].mode === "crossfade");
    s.orch.kill();
  }
  // 5. explicit STOP → no auto-advance
  {
    const s = station(2);
    s.startPlaying(); s.observe();
    s.orch.stopMusic(); s.observe(); s.endFile("stop"); s.observe();
    assert("5 explicit STOP (status stopped / end-file stop) → no advance", s.advances === 0 && s.loads.length === 1 && s.orch.getState().music.status === "stopped");
    s.orch.kill();
  }
  // 6. ERROR reason → not treated as EOF
  {
    const s = station(2);
    s.startPlaying(); s.observe();
    s.endFile("error", undefined, { file_error: "loading failed" }); s.observe();
    assert("6a end-file error (idle + lastError) → no EOF advance", s.advances === 0 && s.loads.length === 1 && !!s.orch.getState().music.lastError);
    s.orch.kill();
    const q = station(2);
    q.startPlaying(); q.observe();
    q.observe({ status: "idle", attemptId: q.loads[0].attemptId, position: 0, duration: 0, lastError: "mpv process exited (code: 0)", engineReady: false });
    assert("6b MPV process exit / QUIT (idle + lastError + engine down) → no advance", q.advances === 0 && q.loads.length === 1);
    q.orch.kill();
  }
  // 7. last item EOF → no invented loop (even though the user loop mode for manual NEXT is "playlist")
  {
    const s = station(N - 1);
    s.startPlaying(); s.observe();
    s.endFile("eof"); s.observe();
    assert("7 last item EOF → tracker fires once but the step is a no-op: no wrap to 0, no load", s.advances === 1 && s.loads.length === 1 && s.main.getState().currentTrackIndex === N - 1);
    s.orch.kill();
  }
  // 8. LOCAL behavior unchanged: renderer-owned LOCAL session / renderer attempt ids are ignored
  {
    const r = observeUrlEof(initialUrlEofState(), { status: "playing", attemptId: 12, position: 3, duration: 200, lastError: null, engineReady: true }, true);
    const r2 = observeUrlEof({ armedAttemptId: MAIN_WS_ATTEMPT_BASE + 5, consumedAttemptId: null }, { status: "idle", attemptId: MAIN_WS_ATTEMPT_BASE + 5, position: 0, duration: 200, lastError: null, engineReady: true }, false);
    assert("8a renderer-owned (LOCAL) attempt ids never arm the URL tracker", r.state.armedAttemptId === null && !r.advance);
    assert("8b LOCAL session owned (no URL session) → never advances", !r2.advance);
    const s = station(1);
    s.startPlaying(); s.observe(); s.setLocalOwned(true); s.endFile("eof"); s.observe();
    assert("8c after a LOCAL selection reacquired ownership, a MAIN URL EOF does nothing", s.advances === 0 && s.loads.length === 1);
    s.orch.kill();
  }
  // 9. manual NEXT racing a natural EOF → still one step
  {
    const s = station(5);
    s.startPlaying(); s.observe();
    s.step("next"); // manual NEXT (disarms)
    s.observe({ status: "idle", attemptId: s.loads[0].attemptId, position: 0, duration: 240, lastError: null, engineReady: true }); // late EOF of item 5
    assert("9 manual NEXT + late EOF of the old item → exactly one step (to 6), never 7", s.advances === 0 && s.loads.length === 2 && s.loads[1].index === 6);
    s.orch.kill();
  }
  // 10. paused then resumed then EOF → advances once
  {
    const s = station(0);
    s.startPlaying(); s.observe();
    s.curDeck().handleEvent({ event: "property-change", name: "pause", data: true }); s.observe();
    s.curDeck().handleEvent({ event: "property-change", name: "pause", data: false }); s.observe();
    s.endFile("eof"); s.observe();
    assert("10 pause / resume keeps the arm; natural end then advances once to item 1", s.advances === 1 && s.loads.length === 2 && s.loads[1].index === 1);
    s.orch.kill();
  }

  // ── static pins ─────────────────────────────────────────────────────────────────────────────────────────────
  const ctx = read("lib", "device-player-context.tsx");
  assert("S1 context observes desktop status with the pure tracker and steps with noWrap only for EOF",
    /observeUrlEof\(/.test(ctx) && /stepUrlSessionRef\.current\("next", \{ noWrap: true \}\)/.test(ctx) && (ctx.match(/noWrap: true/g) ?? []).length === 1);
  assert("S2 manual NEXT / PREV unchanged (no noWrap, same fallbacks)",
    /else if \(!stepUrlSession\("next"\)\) sendCommandToMaster\("NEXT"\);/.test(ctx) && /else if \(!stepUrlSession\("prev"\)\) sendCommandToMaster\("PREV"\);/.test(ctx));
  assert("S3 every step disarms (no double step) and a URL selection disarms", /urlEofStateRef\.current = disarmUrlEof\(urlEofStateRef\.current\);\n\s+if \("noop" in step\) return true;/.test(ctx) && (ctx.match(/disarmUrlEof\(urlEofStateRef\.current\)/g) ?? []).length === 2);
  assert("S4 MAIN_WS_ATTEMPT_BASE parity with desktop MAIN", /export const MAIN_WS_ATTEMPT_BASE = 1_000_000_000;/.test(read("desktop", "src", "main", "main-attempt-id.ts")) && MAIN_WS_ATTEMPT_BASE === 1_000_000_000);
  // Scope of the URL-EOF commit itself (8e8895a) — bound so later, separately approved commits may touch runtime files.
  const changed = execSync(`git diff --name-only 8e8895a~1 8e8895a -- app lib components server desktop middleware.ts`, { cwd: ROOT }).toString().trim().split("\n").filter(Boolean).sort();
  assert("S5 RENDERER ONLY: 8e8895a changed only lib/device-player-context.tsx + new lib/url-eof-advance.ts", JSON.stringify(changed) === JSON.stringify(["lib/device-player-context.tsx", "lib/url-eof-advance.ts"]), changed.join(","));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
})();
