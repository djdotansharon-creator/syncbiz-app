/**
 * Play Next baseline + shuffle bag — drives the REAL `PlaybackProvider` (mounted in Node with a stub DOM, no browser, no network).
 * PR #60 review (2026-10-23):
 *   - radio / live stream / stream URL: Play Next -> items end -> the station comes BACK and plays (it used to stop = silence);
 *   - a finished single song (one-item list or a bare finished track) still does NOT come back (Ori's 2026-10-16 rule: no second play);
 *   - a playlist still returns to its next track; a lone Play Next item with nothing before it still just ends;
 *   - shuffle: the preload peeks (getNextStreamUrl) never spend the bag, the real advance takes the peeked song,
 *     every song plays once per round, and a different list starts a fresh bag.
 * Run: npx tsx scripts/verify-play-next-baseline.ts
 */
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.IS_REACT_ACT_ENVIRONMENT = true;
const fakeNode = (type = 1) => ({ nodeType: type, nodeName: "DIV", tagName: "DIV", localName: "div", namespaceURI: "http://www.w3.org/1999/xhtml", firstChild: null, lastChild: null, parentNode: null, style: {}, childNodes: [], children: [], addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {}, insertBefore() {}, setAttribute() {}, textContent: "", ownerDocument: null as unknown });
const doc: Record<string, unknown> = { nodeType: 9, createElement: () => fakeNode(), createElementNS: () => fakeNode(), createTextNode: () => fakeNode(3), addEventListener() {}, removeEventListener() {}, documentElement: fakeNode(), body: fakeNode(), visibilityState: "visible", hidden: false, defaultView: null, activeElement: null };
g.window = g;
g.document = doc;
g.localStorage = { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 };
g.sessionStorage = g.localStorage;
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.dispatchEvent = () => true;
Object.defineProperty(g, "navigator", { value: { userAgent: "node-test", onLine: true, language: "en" }, configurable: true });
g.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
g.cancelAnimationFrame = (n: unknown) => clearTimeout(n as never);
(doc as { defaultView: unknown }).defaultView = g;
for (const n of ["HTMLIFrameElement", "HTMLElement", "Element", "Node", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement"]) g[n] = class {};

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { UnifiedSource } from "../lib/source-types";
import type { Playlist, PlaylistTrack } from "../lib/playlist-types";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}

const realLog = console.log;
const quiet = () => {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
  console.warn = () => {};
};
const loud = () => {
  console.log = realLog;
};

const radio: UnifiedSource = { id: "radio-kan88", title: "Kan 88", genre: "Radio", cover: null, type: "stream-url", url: "https://stream.example.test/kan88.aac", origin: "radio" };
const song = (n: number): UnifiedSource => ({ id: `song-${n}`, title: `Play Next ${n}`, genre: "Mixed", cover: null, type: "stream-url", url: `https://files.example.test/pn${n}.mp3`, origin: "source" });
/** `finite` = real songs (YouTube); otherwise plain file URLs that are not embedded (so the preload peek returns a URL). */
const tracks = (n: number, prefix = "t", finite = false): PlaylistTrack[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} ${i}`, type: finite ? "youtube" : "local", url: finite ? `https://www.youtube.com/watch?v=${prefix}${String(i).padStart(11 - prefix.length, "x")}` : `https://files.example.test/${prefix}${i}.mp3` }));
const playlist = (id: string, n: number, finite = false): UnifiedSource => {
  const t = finite ? "youtube" : "local";
  const pl: Playlist = { id, name: id, genre: "Mixed", type: t, url: finite ? "https://www.youtube.com/watch?v=aaaaaaaaaaa" : `https://files.example.test/${id}.mp3`, thumbnail: "", createdAt: "2026-10-23T00:00:00Z", tracks: tracks(n, id, finite) };
  return { id, title: id, genre: "Mixed", cover: null, type: t, url: pl.url, origin: "playlist", playlist: pl };
};

async function main() {
  const { PlaybackProvider, usePlayback } = await import("../lib/playback-provider");
  const { setRepeatMode } = await import("../lib/mix-preferences");
  let api: ReturnType<typeof usePlayback> | null = null;
  function Probe() {
    // eslint-disable-next-line react-hooks/globals -- test probe: hands the live context value to the script below
    api = usePlayback();
    return null;
  }
  const container = fakeNode(1) as unknown as Element;
  (container as unknown as { ownerDocument: unknown }).ownerDocument = doc;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(PlaybackProvider, null, React.createElement(Probe)));
  });
  const A = () => api!;
  const run = async (fn: () => void) => {
    await act(async () => {
      fn();
    });
  };
  /** back to a clean slate between scenarios */
  const reset = async () => {
    await run(() => {
      A().stop();
    });
    await run(() => {
      A().setQueue([]);
    });
  };
  const manualNext = () => run(() => A().next());
  const naturalEnd = () => run(() => A().next({ auditTransportCase: "ended_auto" }));
  const unlock = () => (A().next.length, undefined); // (transport lock is released inside next(); nothing to do)
  void unlock;

  quiet();
  await run(() => setRepeatMode("playlist"));
  await run(() => A().setShuffle(false));

  // ── 1. radio -> Play Next -> ends -> radio comes back (the PR #60 bug) ─────────────────────────────────────────────
  await run(() => A().playSource(radio));
  loud();
  assert("1a radio is playing", A().currentSource?.id === radio.id && A().status === "playing", { id: A().currentSource?.id, status: A().status });
  quiet();
  await run(() => A().addPlayNextSources([song(1)]));
  await manualNext(); // the operator presses NEXT on the radio: the Play Next song starts
  loud();
  assert("1b Play Next song plays and the radio is kept as the way back", A().currentSource?.id.startsWith("playnext-") === true && A().playNextBaseline?.currentSource.id === radio.id, { cur: A().currentSource?.id, base: A().playNextBaseline?.currentSource.id });
  quiet();
  await naturalEnd(); // the song ends by itself
  loud();
  assert("1c the song ended -> the RADIO is back and playing (not stopped)", A().currentSource?.id === radio.id && A().status === "playing", { id: A().currentSource?.id, status: A().status });
  assert("1d the way back is spent", A().playNextBaseline === null && A().playNextQueue.length === 0);

  // ── 2. radio + two Play Next songs: the second follows, then the radio ───────────────────────────────────────────
  quiet();
  await reset();
  await run(() => A().playSource(radio));
  await run(() => A().addPlayNextSources([song(1), song(2)]));
  await manualNext();
  await naturalEnd();
  loud();
  assert("2a first song ended -> second Play Next song plays", A().currentSource?.title === "Play Next 2" && A().status === "playing", { t: A().currentSource?.title, status: A().status });
  quiet();
  await naturalEnd();
  loud();
  assert("2b second song ended -> radio is back and playing", A().currentSource?.id === radio.id && A().status === "playing", { id: A().currentSource?.id, status: A().status });

  // ── 3. a live stream URL (m3u8) behaves like the radio ──────────────────────────────────────────────────────────
  const live: UnifiedSource = { id: "live-1", title: "Live", genre: "Live", cover: null, type: "youtube", url: "https://stream.example.test/live/index.m3u8", origin: "source" };
  quiet();
  await reset();
  await run(() => A().playSource(live));
  await run(() => A().addPlayNextSources([song(1)]));
  await manualNext();
  await naturalEnd();
  loud();
  assert("3 live stream (.m3u8) comes back after the Play Next song", A().currentSource?.id === live.id && A().status === "playing", { id: A().currentSource?.id, status: A().status });

  // ── 4. a playlist still returns to its NEXT track (unchanged behaviour) ─────────────────────────────────────────
  const pl3 = playlist("pl-three", 3);
  quiet();
  await reset();
  await run(() => A().playSource(pl3, 1));
  await run(() => A().addPlayNextSources([song(1)]));
  await manualNext();
  const baseIdx = A().playNextBaseline?.currentTrackIndex;
  await naturalEnd();
  loud();
  assert("4 playlist: baseline kept at track 1, after the song it plays track 2", baseIdx === 1 && A().currentSource?.id === pl3.id && A().currentTrackIndex === 2 && A().status === "playing", { baseIdx, id: A().currentSource?.id, idx: A().currentTrackIndex, status: A().status });

  // ── 5. a single song from a ONE-item list does not come back (Ori 2026-10-16: no second play) ───────────────────
  const solo = playlist("pl-solo", 1, true);
  quiet();
  await reset();
  await run(() => A().playSource(solo));
  await run(() => A().addPlayNextSources([song(1)]));
  await manualNext();
  loud();
  assert("5a one-item list: no way back is kept", A().playNextBaseline === null, A().playNextBaseline?.currentSource.id);
  quiet();
  await naturalEnd();
  loud();
  assert("5b one-item list: after the Play Next song nothing plays the solo song again", A().currentSource?.id !== solo.id && A().status === "stopped", { id: A().currentSource?.id, status: A().status });

  // ── 6. a finished bare single song (no list, not a stream) does not come back either ─────────────────────────────
  const bare: UnifiedSource = { id: "search-play-abc", title: "One song", genre: "Mixed", cover: null, type: "youtube", url: "https://www.youtube.com/watch?v=abcdefghijk", origin: "playlist" };
  quiet();
  await reset();
  await run(() => A().playSource(bare));
  await run(() => A().addPlayNextSources([song(1)]));
  await manualNext();
  loud();
  assert("6 bare YouTube song: no way back is kept", A().playNextBaseline === null, A().playNextBaseline?.currentSource.id);

  // ── 7. a lone Play Next item with nothing before it just ends ───────────────────────────────────────────────────
  quiet();
  await reset();
  await run(() => A().addPlayNextSources([song(1)]));
  await manualNext();
  await naturalEnd();
  loud();
  assert("7 lone Play Next item ends -> stopped, no phantom return", A().status === "stopped" && A().playNextBaseline === null, { status: A().status });

  // ── 8. shuffle: peeking never spends the bag; the real advance takes the peeked song; one round = every song once ─
  const N = 6;
  const shufflePl = playlist("pl-shuffle", N);
  quiet();
  await reset();
  await run(() => A().setShuffle(true));
  await run(() => A().playSource(shufflePl, 0));
  const idxOfUrl = (u: string | null) => shufflePl.playlist!.tracks!.findIndex((t) => t.url === u);
  const seen = new Set<number>([0]);
  let peekStable = true;
  let advanceMatchesPeek = true;
  const sequence = [0];
  for (let step = 0; step < N - 1; step++) {
    const first = A().getNextStreamUrl();
    for (let k = 0; k < 25; k++) if (A().getNextStreamUrl() !== first) peekStable = false; // 25 more peeks: same answer, nothing spent
    const peeked = idxOfUrl(first);
    await manualNext();
    const now = A().currentTrackIndex;
    if (now !== peeked) advanceMatchesPeek = false;
    seen.add(now);
    sequence.push(now);
  }
  loud();
  assert("8a repeated peeks keep giving the same next song", peekStable);
  assert("8b the real advance plays the song the peek preloaded", advanceMatchesPeek, sequence);
  assert(`8c one round of ${N - 1} advances visits every song exactly once`, seen.size === N, sequence);

  // a different list (same length) starts a fresh bag: first pick can be any song except the one playing
  quiet();
  const other = playlist("pl-other", N);
  await run(() => A().playSource(other, 0));
  const peekedOther = other.playlist!.tracks!.findIndex((t) => t.url === A().getNextStreamUrl());
  loud();
  assert("8d a different list of the same length starts fresh (peek is a valid song of the NEW list)", peekedOther >= 1 && peekedOther < N, peekedOther);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  loud();
  console.log("FAILED:", String((e && (e as Error).stack) || e).slice(0, 1200));
  process.exit(1);
});
