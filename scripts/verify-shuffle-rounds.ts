/**
 * Random / Shuffle (owner 2026-10-28): Random ON plays the list in a random order and goes through EVERY song once before a
 * new random round; the AutoMix pre-load is exactly the song that plays next; with an explicit Loop Off the list stops only
 * after the whole round — never because Random landed on the list's last position. Random OFF is unchanged (order, then wrap).
 * Drives the REAL PlaybackProvider in Node (stub DOM, no network).
 * Run: npx tsx scripts/verify-shuffle-rounds.ts
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

g.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response;

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { UnifiedSource } from "../lib/source-types";
import type { Playlist, PlaylistTrack } from "../lib/playlist-types";
import { ShuffleOrder, shuffleKeyOf } from "../lib/shuffle-order";

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

/** Every consecutive block of `n` songs (from the first played one) holds each of the n songs exactly once. */
function roundsComplete(seq: number[], n: number): boolean {
  for (let i = 0; i + n <= seq.length; i += n) if (new Set(seq.slice(i, i + n)).size !== n) return false;
  return true;
}
const noRepeatInARow = (seq: number[]) => seq.every((v, i) => i === 0 || v !== seq[i - 1]);

const ytId = (prefix: string, i: number) => `${prefix}${String(i).padStart(11 - prefix.length, "x")}`;
const ytTracks = (n: number, prefix: string): PlaylistTrack[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} ${i}`, type: "youtube", url: `https://www.youtube.com/watch?v=${ytId(prefix, i)}` }));
const streamTracks = (n: number, prefix: string): PlaylistTrack[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} ${i}`, type: "stream-url", url: `https://media.example.test/${prefix}/${i}.mp3` }));
const playlist = (id: string, tracks: PlaylistTrack[]): UnifiedSource => {
  const pl: Playlist = { id, name: id, genre: "Mixed", type: tracks[0]!.type, url: tracks[0]!.url, thumbnail: "", createdAt: "2026-10-28T00:00:00Z", tracks };
  return { id, title: id, genre: "Mixed", cover: null, type: pl.type, url: pl.url, origin: "playlist", playlist: pl };
};

async function main() {
  // ── U. the shuffle order itself ───────────────────────────────────────────────────────────────────────────────────
  {
    const o = new ShuffleOrder();
    const key = shuffleKeyOf(ytTracks(6, "u"));
    let cur = 0;
    const seq = [cur];
    let peekOk = true;
    for (let i = 0; i < 6 * 50; i++) {
      const p = o.peek(key, 6, cur);
      const p2 = o.peek(key, 6, cur);
      const ends = o.roundEnds(key, 6, cur);
      cur = o.advance(key, 6, cur);
      if (p !== cur || p2 !== cur) peekOk = false;
      if (ends !== (seq.length % 6 === 0)) peekOk = false;
      seq.push(cur);
    }
    assert("U1 50 rounds: every round plays each of the 6 songs exactly once", roundsComplete(seq, 6), seq.slice(0, 18));
    assert("U2 never the same song twice in a row (also across rounds)", noRepeatInARow(seq));
    assert("U3 peek (pre-load) always equals the song that plays next; roundEnds marks the 6th song of every round", peekOk);
    const first = o.advance(key, 6, cur);
    assert("U4 a repeated advance for the same step (React re-runs an updater) returns the same song", o.advance(key, 6, cur) === first);
    const o2 = new ShuffleOrder();
    const k6 = shuffleKeyOf(ytTracks(6, "h"));
    let c = 0;
    const played = [c];
    c = o2.advance(k6, 6, c);
    played.push(c);
    const notYet = [0, 1, 2, 3, 4, 5].find((i) => !played.includes(i) && i !== o2.peek(k6, 6, c))!;
    c = notYet; // picked by hand
    played.push(c);
    while (!o2.roundEnds(k6, 6, c)) {
      c = o2.advance(k6, 6, c);
      played.push(c);
    }
    assert("U5 a song picked by hand mid-round counts as played; the round still ends with all 6 songs, none twice", played.length === 6 && new Set(played).size === 6, played);
    const kA = shuffleKeyOf(ytTracks(6, "a"));
    const kB = shuffleKeyOf(ytTracks(6, "b"));
    assert("U6 two different lists of the same length get different order keys", kA !== kB);
  }

  // ── R. the REAL PlaybackProvider ──────────────────────────────────────────────────────────────────────────────────
  const { PlaybackProvider, usePlayback } = await import("../lib/playback-provider");
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
  const naturalEnd = () => run(() => A().next({ auditTransportCase: "ended_auto" }));
  const reset = async () => {
    await run(() => A().stop());
    await run(() => A().setQueue([]));
  };
  /** The pre-loaded next song (AutoMix standby) as a track index, read like the player reads it — many times per song. */
  const peekIndex = (tracks: PlaylistTrack[]): number | null => {
    const emb = A().getNextEmbeddedSource();
    const stream = A().getNextStreamUrl();
    const url = emb?.url ?? stream;
    if (!url) return null;
    const i = tracks.findIndex((t) => url.includes(t.url.split("v=").pop()!));
    return i;
  };

  // A. Random OFF: the order the business arranged, then from the start again
  {
    const tracks = streamTracks(6, "seq");
    const list = playlist("seq-six", tracks);
    quiet();
    await run(() => A().setShuffle(false));
    await run(() => A().playSource(list, 0));
    const seq = [A().currentTrackIndex];
    for (let i = 0; i < 13; i++) {
      await naturalEnd();
      seq.push(A().currentTrackIndex);
    }
    loud();
    assert("A1 Random off: plays 0..5 in order, then starts again from 0 (unchanged behavior)", seq.join(",") === "0,1,2,3,4,5,0,1,2,3,4,5,0,1", seq);
    quiet();
    await reset();
    loud();
  }

  // B/C. Random ON, loop untouched: full rounds, the pre-load is what plays, never a stop
  for (const [label, tracks] of [
    ["YouTube list (embedded pre-load)", ytTracks(6, "ytr")],
    ["stream list (stream pre-load)", streamTracks(6, "str")],
  ] as const) {
    const list = playlist(`rnd-${tracks[0]!.id}`, [...tracks]);
    quiet();
    await run(() => A().setShuffle(true));
    await run(() => A().playSource(list, 0));
    const seq = [A().currentTrackIndex];
    let mismatches = 0;
    let stopped = false;
    for (let i = 0; i < 6 * 6; i++) {
      const before = peekIndex(tracks);
      for (let k = 0; k < 5; k++) peekIndex(tracks); // the player asks on every timeupdate
      await naturalEnd();
      if (A().status !== "playing") stopped = true;
      if (before !== A().currentTrackIndex) mismatches++;
      seq.push(A().currentTrackIndex);
    }
    loud();
    assert(`B1 ${label}: 6 rounds — each round plays all 6 songs exactly once`, roundsComplete(seq, 6), seq);
    assert(`B2 ${label}: never the same song twice in a row`, noRepeatInARow(seq), seq);
    assert(`C1 ${label}: the pre-loaded (AutoMix) song is the song that plays next — every time`, mismatches === 0, { mismatches });
    assert(`C2 ${label}: Random never stops the music (loop untouched)`, !stopped);
    quiet();
    await reset();
    loud();
  }

  // D. Random ON + LOOP OFF chosen explicitly: stops only after ALL songs played — never at the list's original last position
  {
    const tracks = ytTracks(6, "off");
    const list = playlist("rnd-off", tracks);
    let bad = 0;
    const samples: number[][] = [];
    quiet();
    localStorage.setItem("syncbiz-repeat-mode", "off");
    await run(() => A().setShuffle(true));
    for (let r = 0; r < 25; r++) {
      await run(() => A().playSource(list, r % 6));
      const seq = [A().currentTrackIndex];
      for (let i = 0; i < 10 && A().status === "playing"; i++) {
        await naturalEnd();
        if (A().status === "playing") seq.push(A().currentTrackIndex);
      }
      if (seq.length !== 6 || new Set(seq).size !== 6 || A().status !== "stopped") {
        bad++;
        samples.push(seq);
      }
      await reset();
    }
    // the last song of the round is playing, the operator presses NEXT: nothing to move to (Loop Off) — the song then ends -> stop
    await run(() => A().playSource(list, 0));
    for (let i = 0; i < 5; i++) await naturalEnd();
    const lastOfRound = A().currentTrackIndex;
    await run(() => A().next());
    const afterManual = { status: A().status, idx: A().currentTrackIndex };
    await naturalEnd();
    const d2 = afterManual.status === "playing" && afterManual.idx === lastOfRound && A().status === "stopped";
    const d2detail = { lastOfRound, afterManual, final: A().status };
    await reset();
    localStorage.removeItem("syncbiz-repeat-mode");
    loud();
    assert("D2 Loop Off + Random: manual NEXT on the round's last song keeps it playing; when it ends the list stops", d2, d2detail);
    assert("D1 explicit Loop Off + Random (25 runs): plays all 6 songs once, then stops — never earlier", bad === 0, samples.slice(0, 3));
  }

  // E. another list of the same length starts its own round (the old list's round does not leak into it)
  {
    const t1 = ytTracks(6, "one");
    const t2 = ytTracks(6, "two");
    quiet();
    await run(() => A().setShuffle(true));
    await run(() => A().playSource(playlist("list-one", t1), 0));
    await naturalEnd();
    await naturalEnd();
    await run(() => A().playSource(playlist("list-two", t2), 0));
    const seq = [A().currentTrackIndex];
    for (let i = 0; i < 5; i++) {
      await naturalEnd();
      seq.push(A().currentTrackIndex);
    }
    loud();
    assert("E1 switching to another list: its first round plays all 6 of ITS songs", new Set(seq).size === 6, seq);
    quiet();
    await reset();
    loud();
  }

  // M. manual NEXT also follows the order (same rounds as natural ends)
  {
    const tracks = ytTracks(6, "man");
    quiet();
    await run(() => A().setShuffle(true));
    await run(() => A().playSource(playlist("rnd-man", tracks), 3));
    const seq = [A().currentTrackIndex];
    for (let i = 0; i < 17; i++) {
      await run(() => A().next());
      seq.push(A().currentTrackIndex);
    }
    loud();
    assert("M1 manual NEXT with Random: 3 rounds, each all 6 songs once", roundsComplete(seq, 6) && noRepeatInARow(seq), seq);
    quiet();
    await reset();
    loud();
  }

  await act(async () => root.unmount());
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  loud();
  console.error(e);
  process.exit(1);
});
