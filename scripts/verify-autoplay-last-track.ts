/**
 * Defaults + "no replay" (owner 2026-10-23): loop OFF by default, AutoMix ON by default with a 7 s mix, and with loop off
 * the LAST song of a list gets a recommended next song lined up (as a single song does) instead of stopping / starting over.
 * Drives the REAL PlaybackProvider + AutoplayRecommender in Node (stub DOM, stubbed recommend endpoint, no network).
 * Run: npx tsx scripts/verify-autoplay-last-track.ts
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

// the recommendation service: always answers with one candidate (a different one per asked song)
let recommendCalls = 0;
g.fetch = async (input: unknown) => {
  const url = String(input);
  if (url.includes("/api/sources/youtube-recommend")) {
    recommendCalls++;
    const id = `rec${String(recommendCalls).padStart(8, "0")}`; // 11 chars, like a YouTube id
    return { ok: true, json: async () => ({ source: "test", candidates: [{ videoId: id, title: `Recommended ${recommendCalls}`, url: `https://www.youtube.com/watch?v=${id}` }] }) } as unknown as Response;
  }
  return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
};

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

const ytId = (prefix: string, i: number) => `${prefix}${String(i).padStart(11 - prefix.length, "x")}`;
const ytTracks = (n: number, prefix: string): PlaylistTrack[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} ${i}`, type: "youtube", url: `https://www.youtube.com/watch?v=${ytId(prefix, i)}` }));
const playlist = (id: string, n: number): UnifiedSource => {
  const pl: Playlist = { id, name: id, genre: "Mixed", type: "youtube", url: `https://www.youtube.com/watch?v=${ytId(id.slice(0, 3), 0)}`, thumbnail: "", createdAt: "2026-10-23T00:00:00Z", tracks: ytTracks(n, id.slice(0, 3)) };
  return { id, title: id, genre: "Mixed", cover: null, type: "youtube", url: pl.url, origin: "playlist", playlist: pl };
};
const single: UnifiedSource = { id: "search-play-solo", title: "One song", genre: "Mixed", cover: null, type: "youtube", url: `https://www.youtube.com/watch?v=${ytId("sol", 0)}`, origin: "playlist" };

async function main() {
  const { PlaybackProvider, usePlayback } = await import("../lib/playback-provider");
  const { sessionRepeatMode } = await import("../lib/playback-provider");
  const { AutoplayRecommender } = await import("../components/autoplay-recommender");
  const mix = await import("../lib/mix-preferences");

  // ── D. defaults on a fresh browser ────────────────────────────────────────────────────────────────────────────────
  assert("D1 loop is OFF by default", mix.getRepeatMode() === "off");
  assert("D2 AutoMix is ON by default", mix.getAutoMix() === true);
  assert("D3 the default mix is 7 s", mix.getMixDuration() === 7);
  assert("D4 7 s is one of the choices the setting offers", (mix.MIX_DURATIONS as readonly number[]).includes(7));
  store.set("syncbiz-repeat-mode", "playlist");
  store.set("syncbiz-automix", "0");
  store.set("syncbiz-mix-duration", "9");
  assert("D5 what the operator chose is still honoured (loop on / AutoMix off / 9 s)", mix.getRepeatMode() === "playlist" && mix.getAutoMix() === false && mix.getMixDuration() === 9);
  store.clear();

  // ── P. a LOCAL playlist keeps going (never silence in a store) unless the operator chose "off" ──────────────────────
  assert("P1 untouched loop (default off) + local files -> the list wraps", sessionRepeatMode("off", [{ type: "local" }, { type: "local" }]) === "playlist");
  assert("P2 online list, default off -> stays off (it gets a recommended next song instead)", sessionRepeatMode("off", [{ type: "youtube" }, { type: "youtube" }]) === "off");
  store.set("syncbiz-repeat-mode", "off");
  assert("P3 the operator CHOSE off -> a local list stops as asked", sessionRepeatMode("off", [{ type: "local" }]) === "off");
  store.clear();
  assert("P4 loop ON / loop-this-track are never changed", sessionRepeatMode("playlist", [{ type: "local" }]) === "playlist" && sessionRepeatMode("track", [{ type: "local" }]) === "track");

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
    root.render(React.createElement(PlaybackProvider, null, React.createElement(Probe), React.createElement(AutoplayRecommender)));
  });
  const A = () => api!;
  const run = async (fn: () => void) => {
    await act(async () => {
      fn();
    });
  };
  const settle = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60)); // the recommender's first attempt has no delay
    });
  };
  const autoplayLined = () => A().playNextQueue.filter((s) => s.genre === "Autoplay").length;
  const reset = async () => {
    await run(() => A().stop());
    await run(() => A().setQueue([]));
    for (const it of [...A().playNextQueue]) await run(() => A().removePlayNextItem(it.id));
  };
  const naturalEnd = () => run(() => A().next({ auditTransportCase: "ended_auto" }));

  quiet();
  // ── L. the last song of a list (loop OFF = the default) ───────────────────────────────────────────────────────────
  const list3 = playlist("album-three", 3);
  await run(() => A().playSource(list3, 0));
  await settle();
  loud();
  assert("L1 first song of a list: nothing is lined up (the list continues by itself)", autoplayLined() === 0, A().playNextQueue.map((s) => s.title));
  quiet();
  await run(() => A().playSource(list3, 2));
  await settle();
  loud();
  assert("L2 LAST song of a list (loop off): a recommended next song is lined up", autoplayLined() === 1, A().playNextQueue.map((s) => s.title));
  quiet();
  await run(() => A().playSource(list3, 1));
  await settle();
  loud();
  assert("L3 back to a middle song: that recommendation is taken away (it must not fire mid-album)", autoplayLined() === 0, A().playNextQueue.map((s) => s.title));
  quiet();
  await run(() => A().playSource(list3, 2));
  await settle();
  loud();
  assert("L4 on the last song again: lined up again", autoplayLined() === 1);
  quiet();
  await naturalEnd();
  await settle();
  loud();
  assert("L5 the last song ends -> the recommended song plays (the list does not start over)", A().currentSource?.genre === "Autoplay" && A().status === "playing", { id: A().currentSource?.id, genre: A().currentSource?.genre, status: A().status });

  // ── L. loop ON: the list wraps by itself, nothing extra is lined up ──────────────────────────────────────────────
  quiet();
  await reset();
  store.set("syncbiz-repeat-mode", "playlist");
  await run(() => A().playSource(list3, 2));
  await settle();
  loud();
  assert("L6 loop ON, last song: nothing lined up (the list loops)", autoplayLined() === 0, A().playNextQueue.map((s) => s.title));
  store.clear();

  // a LOCAL playlist through the real provider: its last file ends -> the list starts again from the first file
  const localList: UnifiedSource = (() => {
    const pl: Playlist = { id: "local-three", name: "local-three", genre: "Mixed", type: "local", url: "C:\\Music\\a.mp3", thumbnail: "", createdAt: "2026-10-23T00:00:00Z", tracks: [0, 1, 2].map((i) => ({ id: `lc${i}`, name: `lc ${i}`, type: "local" as const, url: `C:\\Music\\t${i}.mp3` })) };
    return { id: "local-three", title: "local-three", genre: "Mixed", cover: null, type: "local", url: pl.url, origin: "playlist", playlist: pl };
  })();
  quiet();
  await reset();
  await run(() => A().playSource(localList, 2));
  const startedLocal = A().currentSource?.id === localList.id;
  await naturalEnd();
  loud();
  if (!startedLocal) console.log("NOTE  L7 skipped: this Node environment does not allow LOCAL playback (provider blocked playSource)");
  else assert("L7 LOCAL playlist, last file ends -> starts again from the first file (default loop off)", A().currentSource?.id === localList.id && A().currentTrackIndex === 0 && A().status === "playing", { idx: A().currentTrackIndex, status: A().status });

  // ── S. a single song: it does not start over ─────────────────────────────────────────────────────────────────────
  quiet();
  await reset();
  await run(() => A().playSource(single));
  await settle();
  loud();
  assert("S1 single song: its recommended next song is lined up", autoplayLined() === 1);
  quiet();
  await naturalEnd();
  await settle();
  loud();
  assert("S2 the single song ends -> the recommendation plays, not the same song again", A().currentSource?.genre === "Autoplay" && A().currentSource?.id !== single.id, { id: A().currentSource?.id });

  // ── Q. the operator's "Play next" goes in FRONT of the platform's own pick (owner 2026-10-26) ─────────────────────────
  const picked = (id: string, title: string): UnifiedSource => ({ id, title, genre: "Mixed", cover: null, type: "youtube", url: `https://www.youtube.com/watch?v=${ytId(id.slice(0, 3), 7)}`, origin: "playlist" });
  const opA = picked("opA", "Operator A");
  const opB = picked("opB", "Operator B");
  quiet();
  await reset();
  g.fetch = async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/sources/youtube-recommend")) {
      recommendCalls++;
      const id = `rec${String(recommendCalls).padStart(8, "0")}`;
      return { ok: true, json: async () => ({ source: "test", candidates: [{ videoId: id, title: `Recommended ${recommendCalls}`, url: `https://www.youtube.com/watch?v=${id}` }] }) } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  };
  store.clear();
  await run(() => A().playSource(single));
  await settle();
  const lined = A().playNextQueue.map((s) => s.title);
  await run(() => A().addPlayNextSources([opA]));
  await settle();
  loud();
  assert("Q1 a recommendation was waiting; the operator presses 'Play next' -> the operator's song is FIRST and the recommendation has stepped aside", lined.length === 1 && A().playNextQueue[0]?.title === "Operator A" && autoplayLined() === 0, { before: lined, after: A().playNextQueue.map((s) => s.title) });
  quiet();
  await run(() => A().addPlayNextSources([opB]));
  await settle();
  loud();
  assert("Q2 two 'Play next' presses keep the order the operator chose (the first one plays first)", A().playNextQueue.map((s) => s.title).join(",") === "Operator A,Operator B", A().playNextQueue.map((s) => s.title));
  quiet();
  await naturalEnd();
  await settle();
  loud();
  assert("Q3 the song ends -> the operator's first choice plays (not the recommendation)", A().currentSource?.title === "Operator A" && A().status === "playing", { title: A().currentSource?.title, status: A().status });
  quiet();
  await naturalEnd();
  await settle();
  loud();
  assert("Q4 …then the second choice; the queue is empty of recommendations while the operator's songs are waiting", A().currentSource?.title === "Operator B", { title: A().currentSource?.title });
  assert("Q5 once only the operator's last song is playing, a recommendation is lined up for IT (nothing is left without a next song)", autoplayLined() === 1, A().playNextQueue.map((s) => s.title));
  // a slow recommendation that arrives AFTER the operator queued something must not end up in front of it
  quiet();
  await reset();
  g.fetch = async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/sources/youtube-recommend")) {
      recommendCalls++;
      const id = `rec${String(recommendCalls).padStart(8, "0")}`;
      await new Promise((r) => setTimeout(r, 120));
      return { ok: true, json: async () => ({ source: "test", candidates: [{ videoId: id, title: `Slow ${recommendCalls}`, url: `https://www.youtube.com/watch?v=${id}` }] }) } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  };
  await run(() => A().playSource(single));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  await run(() => A().addPlayNextSources([opA]));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
  loud();
  assert("Q6 a SLOW recommendation that arrives after the operator queued a song never ends up in front of it", A().playNextQueue[0]?.title === "Operator A" && autoplayLined() === 0, A().playNextQueue.map((s) => s.title));
  quiet();
  g.fetch = async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/sources/youtube-recommend")) {
      recommendCalls++;
      const id = `rec${String(recommendCalls).padStart(8, "0")}`;
      return { ok: true, json: async () => ({ source: "test", candidates: [{ videoId: id, title: `Recommended ${recommendCalls}`, url: `https://www.youtube.com/watch?v=${id}` }] }) } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  };
  await reset();

  // single song with NO recommendation available: with loop off it just ends (no replay)
  quiet();
  await reset();
  g.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response;
  store.set("syncbiz:autoplayNext", "off");
  await run(() => A().playSource(single));
  await settle();
  await naturalEnd();
  loud();
  assert("S3 single song, nothing recommended: it ENDS (stopped) — it does not start over", A().status === "stopped", { status: A().status, id: A().currentSource?.id });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  loud();
  console.log("FAILED:", String((e && (e as Error).stack) || e).slice(0, 1400));
  process.exit(1);
});
