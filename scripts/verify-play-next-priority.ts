/**
 * Play Next comes first (owner 2026-10-28): while the Play Next stack holds songs, its first song is the next song — after a
 * list / bank song too, by a natural end, a manual NEXT or the AutoMix crossfade. The AutoMix pre-load (getNextStreamUrl /
 * getNextEmbeddedSource) must therefore be exactly that song; before this fix it was the LIST's next song, so the crossfade
 * played a list song while the provider moved on to the Play Next song (a song never heard, then one song late, then silence).
 * Drives the REAL PlaybackProvider in Node (stub DOM, no network).
 * Run: npx tsx scripts/verify-play-next-priority.ts
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
const streamTracks = (n: number, prefix: string): PlaylistTrack[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} ${i}`, type: "stream-url", url: `https://media.example.test/${prefix}/${i}.mp3` }));
const playlist = (id: string, tracks: PlaylistTrack[]): UnifiedSource => {
  const pl: Playlist = { id, name: id, genre: "Mixed", type: tracks[0]!.type, url: tracks[0]!.url, thumbnail: "", createdAt: "2026-10-28T00:00:00Z", tracks };
  return { id, title: id, genre: "Mixed", cover: null, type: pl.type, url: pl.url, origin: "playlist", playlist: pl };
};

async function main() {
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
  const reset = async () => {
    await run(() => A().stop());
    await run(() => A().setQueue([]));
    for (const it of [...A().playNextQueue]) await run(() => A().removePlayNextItem(it.id));
  };
  const pn = (kind: "yt" | "st", tag: string): UnifiedSource =>
    kind === "yt"
      ? { id: `pn-${tag}`, title: `PN ${tag}`, genre: "x", cover: null, type: "youtube", url: `https://www.youtube.com/watch?v=${ytId("pn" + tag, 0)}`, origin: "playlist" }
      : { id: `pn-${tag}`, title: `PN ${tag}`, genre: "x", cover: null, type: "stream-url", url: `https://media.example.test/pn/${tag}.mp3`, origin: "playlist" };
  /** What the player would pre-load / crossfade into now (YouTube deck for a YouTube song, audio deck otherwise). */
  const preload = (curType: string): string | null => (curType === "youtube" ? A().getNextEmbeddedSource()?.url ?? null : A().getNextStreamUrl());
  const curUrl = () => {
    const s = A().currentSource;
    if (!s) return null;
    const pl = s.playlist;
    if (pl?.tracks?.length) return pl.tracks[A().currentTrackIndex]?.url ?? null;
    return s.url;
  };
  /** The AutoMix crossfade: the pre-loaded song starts, then the provider moves on (skipPlay) — both must name the same song. */
  const crossfade = async (curType: string) => {
    const pre = preload(curType);
    await run(() => A().next({ skipPlay: true, auditTransportCase: "ended_auto" }));
    return { pre, now: curUrl() };
  };

  for (const [label, list, kind] of [
    ["bank / stream list", streamTracks(6, "bank"), "st"],
    ["YouTube list", ytTracks(6, "oma"), "yt"],
  ] as const) {
    for (const shuffle of [false, true]) {
      const tag = `${label}${shuffle ? ", Random ON" : ""}`;
      quiet();
      await run(() => A().setShuffle(shuffle));
      await run(() => A().playSource(playlist(`pl-${list[0]!.id}-${shuffle}`, [...list]), 1));
      const baseIdx = A().currentTrackIndex;
      await run(() => A().addPlayNextSources([pn(kind, "A"), pn(kind, "B"), pn(kind, "C")]));
      const firstPre = preload(list[0]!.type);
      const steps: { pre: string | null; now: string | null }[] = [];
      for (let i = 0; i < 3; i++) steps.push(await crossfade(i === 0 ? list[0]!.type : kind === "yt" ? "youtube" : "stream-url"));
      const order = steps.map((x) => (x.now ?? "").match(/pn(A|B|C)|\/pn\/(A|B|C)/)?.slice(1).find(Boolean) ?? "list");
      const stackAfter = A().playNextQueue.length;
      // back to the list: no pre-load from the last Play Next song (unchanged) -> it ends naturally and the list continues
      const backPre = preload(kind === "yt" ? "youtube" : "stream-url");
      if (backPre) await run(() => A().next({ skipPlay: true, auditTransportCase: "ended_auto" }));
      else await run(() => A().next({ auditTransportCase: "ended_auto" }));
      const back = { pre: backPre, now: curUrl() };
      loud();
      assert(`P1 ${tag}: with songs in Play Next, the pre-load from a LIST song is Play Next's first song`, !!firstPre && firstPre.includes(kind === "yt" ? "pnA" : "/pn/A"), { firstPre });
      assert(`P2 ${tag}: every crossfade plays exactly the pre-loaded song (screen == heard)`, steps.every((x) => !!x.pre && !!x.now && x.now.includes(x.pre.replace(/[?&]mt=.*$/, "").split("v=").pop()!)), steps);
      assert(`P3 ${tag}: Play Next plays A, B, C in order, each once, and the stack empties`, order.join(",") === "A,B,C" && stackAfter === 0, { order, stackAfter });
      const expectIdx = shuffle ? A().currentTrackIndex !== baseIdx : A().currentTrackIndex === baseIdx + 1;
      assert(`P4 ${tag}: after the stack the LIST continues where it left off (the next list song, playing — no silence)`, A().currentSource?.id?.startsWith("pl-") === true && A().status === "playing" && expectIdx && (!back.pre || (!!back.now && back.now.includes(back.pre.split("v=").pop()!))), { cur: A().currentSource?.id, idx: A().currentTrackIndex, baseIdx, back });
      quiet();
      await reset();
      loud();
    }
  }

  // mixed types: the pre-load engine cannot carry the Play Next song -> NO pre-load (never the list's song); the song ends -> Play Next
  {
    quiet();
    await run(() => A().setShuffle(false));
    await run(() => A().playSource(playlist("pl-mixed-st", streamTracks(6, "mxs")), 1));
    await run(() => A().addPlayNextSources([pn("yt", "Y")]));
    const st = A().getNextStreamUrl();
    await run(() => A().next({ auditTransportCase: "ended_auto" }));
    const afterSt = A().currentSource?.title;
    await reset();
    await run(() => A().playSource(playlist("pl-mixed-yt", ytTracks(6, "mxy")), 1));
    await run(() => A().addPlayNextSources([pn("st", "S")]));
    const em = A().getNextEmbeddedSource();
    await run(() => A().next({ auditTransportCase: "ended_auto" }));
    const afterYt = A().currentSource?.title;
    await reset();
    loud();
    assert("M1 stream list + a YouTube song in Play Next: no audio pre-load; when the song ends the Play Next song plays", st === null && afterSt === "PN Y", { st, afterSt });
    assert("M2 YouTube list + a stream song in Play Next: no YouTube pre-load; when the song ends the Play Next song plays", em === null && afterYt === "PN S", { em, afterYt });
  }

  // unchanged: with an EMPTY stack the pre-load is still the list's next song
  {
    quiet();
    await run(() => A().setShuffle(false));
    await run(() => A().playSource(playlist("pl-plain", streamTracks(6, "pln")), 2));
    const pre = A().getNextStreamUrl();
    await reset();
    loud();
    assert("U1 empty Play Next: the pre-load is the list's next song (unchanged)", pre === "https://media.example.test/pln/3.mp3", { pre });
  }

  // the audio player (static — the HTML audio decks do not run in Node; the runtime check is the browser run in the PR)
  {
    const fs = await import("node:fs");
    const ap = fs.readFileSync(new URL("../components/audio-player.tsx", import.meta.url), "utf8");
    assert("S1 both audio decks listen for `ended` (a song on the second deck that ends without a crossfade still moves on)", /\[audioDeckARef\.current, audioDeckBRef\.current\]/.test(ap) && /for \(const deck of decks\) deck\.addEventListener\("ended", onEnded\)/.test(ap) && /if \(audio !== audioRef\.current\)/.test(ap));
    assert("S2 a deck that already ended never starts a pre-load / crossfade", /const canOverlap = !!\([\s\S]{0,120}!a\.ended &&/.test(ap));
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
