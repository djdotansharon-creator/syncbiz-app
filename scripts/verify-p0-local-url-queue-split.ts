/**
 * P0 (2026-10-06) — LOCAL → URL session / transport coherence on the designated station.
 *
 * Uses the REAL routing / URL-session-step helpers (lib/station-transport-routing.ts), the REAL wire payload builder
 * (unifiedSourceToPayload), the REAL playlist leaf expansion, and the REAL desktop MAIN session builder
 * (MockPlaybackSession.setStationSession + getState — what STATE_UPDATE mirrors to CONTROL). A small station harness
 * drives them in the same order as lib/device-player-context.tsx; static checks pin that file to this structure.
 * No DB, no network, no Desktop / MAIN code changed.
 * Run: npx tsx scripts/verify-p0-local-url-queue-split.ts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { routeStationTransport, resolveUrlSessionStep } from "../lib/station-transport-routing";
import { unifiedSourceToPayload } from "../lib/remote-control/source-to-payload";
import { expandPlaylistEntityToItems, playlistLeafTrackIndexForQueueItem } from "../lib/syncbiz-playlist-queue";
import { MockPlaybackSession } from "../desktop/src/playback-agent/mock-playback-session";
import type { UnifiedSource } from "../lib/source-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const ROOT = path.join(__dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf-8").replace(/\r\n/g, "\n");

// ── fixtures: a URL playlist (6 YouTube tracks) and a LOCAL playlist (3 local files) ─────────────────────────
const urlTitles = ["Afro House 2026 Mix", "Afro House Mix 2026", "Afro Soul House 2026", "AFROBEAT GROOVES 2025", "Afro House Jazz Mix", "HITS ONLY 3 Step"];
const urlShell = {
  id: "pl-url", title: "Evening · Afro", genre: "Afro", cover: null, type: "youtube", url: "https://www.youtube.com/watch?v=v0", origin: "playlist",
  playlist: { id: "pl-url", name: "Evening · Afro", type: "youtube", url: "https://www.youtube.com/watch?v=v0",
    tracks: urlTitles.map((t, i) => ({ id: `t${i}`, name: t, type: "youtube", url: `https://www.youtube.com/watch?v=v${i}`, cover: `https://img/v${i}.jpg` })) },
} as unknown as UnifiedSource;
const localShell = {
  id: "pl-local", title: "Soundreef Local", genre: "Lounge", cover: null, type: "local", url: "", origin: "playlist",
  playlist: { id: "pl-local", name: "Soundreef Local", type: "local", url: "",
    tracks: [0, 1, 2].map((i) => ({ id: `l${i}`, name: `Local ${i}`, type: "local", url: `local-file-${i}.mp3`, cover: "" })) },
} as unknown as UnifiedSource;
const urlLeaves = expandPlaylistEntityToItems(urlShell);
const localLeaves = expandPlaylistEntityToItems(localShell);

// ── MAIN: real session builder + the same PLAY_SOURCE metadata mapping as device-ws-manager.ts ───────────────
const main = new MockPlaybackSession();
const mainPlayed: string[] = [];
function mainPlaySource(payload: { source?: Record<string, unknown>; trackIndex?: unknown }): void {
  const src = payload.source as { id: string; title?: string; cover?: string | null; type?: string; origin?: string; url?: string; playlistId?: string; sessionTracks?: { id: string; title: string; cover?: string | null }[] };
  const tracks = Array.isArray(src.sessionTracks) ? src.sessionTracks.map((t) => ({ id: String(t.id), title: t.title ?? "", cover: t.cover ?? null })) : [];
  main.setStationSession({
    id: src.id, title: src.title ?? "", cover: src.cover ?? null,
    origin: src.origin === "playlist" || src.origin === "radio" || src.origin === "source" ? src.origin : undefined,
    sourceType: src.type, url: src.url,
    trackIndex: typeof payload.trackIndex === "number" ? payload.trackIndex : 0,
    sessionTitle: src.title ?? null, sessionPlaylistId: src.playlistId ?? null, sessionTracks: tracks,
  } as Parameters<MockPlaybackSession["setStationSession"]>[0]);
  if (src.url) mainPlayed.push(src.url);
}
const ui = () => { const ms = main.getState(); return { title: ms.currentTrack?.title ?? ms.currentSource?.title ?? null, art: ms.currentTrack?.cover ?? null, index: ms.currentTrackIndex, next: ms.sessionTracks?.[ms.currentTrackIndex + 1]?.title ?? null }; };

// ── station harness: same order as device-player-context (playSourceOrSend / *OrSend) ────────────────────────
type Cmd = { cmd: string; payload?: { source?: Record<string, unknown>; trackIndex?: unknown } };
class Station {
  owned = true; // useRef(true): cold-boot LOCAL restore starts owned
  lastSentUrlLeaf: UnifiedSource | null = null;
  providerCurrent: UnifiedSource | null = null;
  providerIndex = 0;
  ws: Cmd[] = [];
  providerCalls: string[] = [];
  localDispatches: string[] = [];
  repeatMode: "playlist" | "track" | "off" = "playlist";
  // provider stand-in: a local play dispatches a LOCAL file to MPV (the thing that must never happen under a URL session)
  private providerPlay(src: UnifiedSource, ti: number): void {
    this.providerCurrent = src; this.providerIndex = ti; this.providerCalls.push("playSource");
    this.localDispatches.push(`${src.id}#${ti}`);
  }
  private send(cmd: string, payload?: Cmd["payload"]): void {
    this.ws.push({ cmd, payload });
    if (cmd === "PLAY_SOURCE" && payload) mainPlaySource(payload);
  }
  playSourceOrSend(source: UnifiedSource, trackIndex = 0): void {
    if (source.type === "local") { this.owned = true; this.lastSentUrlLeaf = null; this.providerPlay(source, trackIndex); }
    else { this.owned = false; this.lastSentUrlLeaf = source; this.send("PLAY_SOURCE", { source: unifiedSourceToPayload(source) as unknown as Record<string, unknown>, trackIndex }); }
  }
  private runsLocally(): boolean {
    return routeStationTransport({ useLocalDeviceTransport: false, canLocalExec: true, currentSourceIsLocal: this.providerCurrent?.type === "local", localSessionOwned: this.owned }) === "local";
  }
  private step(direction: "next" | "prev"): boolean {
    if (this.owned) return false;
    const ms = main.getState();
    const st = resolveUrlSessionStep({ sentLeaf: this.lastSentUrlLeaf, mainSourceId: ms.currentSource?.id ?? null, mainTrackIndex: ms.currentTrackIndex, mainSessionTrackCount: ms.sessionTracks?.length ?? null, direction, repeatMode: this.repeatMode });
    if (!st) return false;
    if ("noop" in st) return true;
    this.lastSentUrlLeaf = st.leaf;
    this.send("PLAY_SOURCE", { source: unifiedSourceToPayload(st.leaf) as unknown as Record<string, unknown>, trackIndex: st.trackIndex });
    return true;
  }
  nextOrSend(): void {
    if (this.runsLocally()) { this.providerCalls.push("next"); const n = (this.providerIndex + 1) % localLeaves.length; this.localDispatches.push(`next→${n}`); this.providerIndex = n; }
    else if (!this.step("next")) this.send("NEXT");
  }
  prevOrSend(): void {
    if (this.runsLocally()) { this.providerCalls.push("prev"); this.localDispatches.push("prev"); }
    else if (!this.step("prev")) this.send("PREV");
  }
  playOrSend(): void { if (this.runsLocally()) { this.providerCalls.push("play"); this.localDispatches.push("play"); } else this.send("PLAY"); }
  pauseOrSend(): void { if (this.runsLocally()) this.providerCalls.push("pause"); else this.send("PAUSE"); }
  stopOrSend(): void { if (this.runsLocally()) this.providerCalls.push("stop"); else this.send("STOP"); }
}
const lastPlaySource = (s: Station) => [...s.ws].reverse().find((c) => c.cmd === "PLAY_SOURCE");

// ── A + B: LOCAL active & owned → click URL item 3 ────────────────────────────────────────────────────────────
const st = new Station();
st.playSourceOrSend(localLeaves[0], 0);
assert("A: LOCAL playlist active + owned (provider plays LOCAL)", st.owned && st.providerCurrent?.type === "local");
const clicked = urlLeaves[3];
const ti = playlistLeafTrackIndexForQueueItem(clicked);
st.localDispatches = []; st.providerCalls = [];
st.playSourceOrSend(clicked, ti);
const ps = lastPlaySource(st)!;
assert("B: clicked leaf index resolved = 3", ti === 3);
assert("B: PLAY_SOURCE source = clicked item, trackIndex = 3", (ps.payload!.source as { id: string }).id === clicked.id && ps.payload!.trackIndex === 3);
assert("B: MAIN session currentTrack = item 3 (index 3)", ui().index === 3 && ui().title === urlTitles[3]);
assert("B: mirrored title / artwork = item 3, NEXT preview = item 4", ui().title === urlTitles[3] && ui().art === "https://img/v3.jpg" && ui().next === urlTitles[4]);
assert("B: MAIN audio target = the clicked URL", mainPlayed.at(-1) === "https://www.youtube.com/watch?v=v3");
assert("B: LOCAL ownership released, provider untouched", !st.owned && st.localDispatches.length === 0);

// ── C: NEXT ───────────────────────────────────────────────────────────────────────────────────────────────────
st.nextOrSend();
assert("C: provider.next() NOT called", !st.providerCalls.includes("next"));
assert("C: no LOCAL file dispatched", st.localDispatches.length === 0);
const n1 = lastPlaySource(st)!;
assert("C: PLAY_SOURCE = URL item 4, trackIndex 4", (n1.payload!.source as { id: string }).id === urlLeaves[4].id && n1.payload!.trackIndex === 4);
assert("C: MAIN session + title / artwork = item 4", ui().index === 4 && ui().title === urlTitles[4] && ui().art === "https://img/v4.jpg" && mainPlayed.at(-1) === "https://www.youtube.com/watch?v=v4");
assert("C: no bare MAIN NEXT (catalog step) sent", !st.ws.some((c) => c.cmd === "NEXT"));

// ── D: PREV ───────────────────────────────────────────────────────────────────────────────────────────────────
st.prevOrSend();
const p1 = lastPlaySource(st)!;
assert("D: PREV → URL item 3 (trackIndex 3), no LOCAL dispatch", (p1.payload!.source as { id: string }).id === urlLeaves[3].id && p1.payload!.trackIndex === 3 &&
  ui().title === urlTitles[3] && st.localDispatches.length === 0 && !st.providerCalls.includes("prev"));

// ── regression: ZERO provider LOCAL dispatch from any transport during the URL-owned session ─────────────────
st.playOrSend(); st.pauseOrSend(); st.stopOrSend();
assert("URL session: PLAY / PAUSE / STOP go to MAIN, provider untouched, zero LOCAL dispatch",
  st.providerCalls.length === 0 && st.localDispatches.length === 0 && ["PLAY", "PAUSE", "STOP"].every((c) => st.ws.some((x) => x.cmd === c)));
// rapid double NEXT (MAIN mirror one step behind) still steps the URL session, never the catalog / LOCAL
const mirrorLag = new Station();
mirrorLag.playSourceOrSend(localLeaves[0], 0); mirrorLag.playSourceOrSend(urlLeaves[1], 1);
mirrorLag.nextOrSend(); mirrorLag.nextOrSend();
assert("rapid NEXT×2: items 2 then 3 via PLAY_SOURCE (no catalog NEXT, no LOCAL)",
  mirrorLag.ws.filter((c) => c.cmd === "PLAY_SOURCE").map((c) => c.payload!.trackIndex).join(",") === "1,2,3" && !mirrorLag.ws.some((c) => c.cmd === "NEXT") && mirrorLag.localDispatches.length === 1);
// wrap / LOOP semantics
const wrap = new Station();
wrap.playSourceOrSend(urlLeaves[5], 5); wrap.nextOrSend();
assert("LOOP playlist: NEXT on the last item wraps to item 0", lastPlaySource(wrap)!.payload!.trackIndex === 0);
const off = new Station(); off.repeatMode = "off";
off.playSourceOrSend(urlLeaves[5], 5); const before = off.ws.length; off.nextOrSend();
assert("LOOP off: NEXT on the last item does nothing (no wrap, no catalog NEXT)", off.ws.length === before);
const first = new Station(); first.playSourceOrSend(urlLeaves[0], 0); first.prevOrSend();
assert("PREV on item 0 wraps to the last item (provider rule)", lastPlaySource(first)!.payload!.trackIndex === 5);
// incoherent / foreign MAIN session → existing MAIN command fallback
const foreign = new Station(); foreign.playSourceOrSend(urlLeaves[2], 2);
mainPlaySource({ source: { id: "other-session", title: "Other", type: "youtube", url: "https://x" }, trackIndex: 0 });
foreign.nextOrSend();
assert("MAIN on a different session → fallback to the existing MAIN NEXT command", foreign.ws.at(-1)?.cmd === "NEXT" && foreign.localDispatches.length === 0);

// ── E: URL → LOCAL ────────────────────────────────────────────────────────────────────────────────────────────
st.playSourceOrSend(localLeaves[1], 1);
assert("E: LOCAL ownership reacquired, LOCAL plays on the provider", st.owned && st.providerCurrent?.id === localLeaves[1].id && st.localDispatches.length === 1);
st.nextOrSend();
assert("E: LOCAL NEXT still uses provider.next()", st.providerCalls.includes("next") && st.ws.at(-1)?.cmd !== "NEXT");

// ── F: cold-start LOCAL restore (provider restored directly; ownership starts owned) ─────────────────────────
const cold = new Station();
(cold as unknown as { providerCurrent: UnifiedSource }).providerCurrent = localLeaves[2];
cold.nextOrSend();
assert("F: cold restore → LOCAL-owned, NEXT runs on the provider", cold.owned && cold.providerCalls.includes("next") && cold.ws.length === 0);

// ── pure routing ──────────────────────────────────────────────────────────────────────────────────────────────
const r = (o: Partial<Parameters<typeof routeStationTransport>[0]>) => routeStationTransport({ useLocalDeviceTransport: false, canLocalExec: true, currentSourceIsLocal: true, localSessionOwned: true, ...o });
assert("routing: MASTER-mode renderer always local; designated+local+owned local; not owned / not local / not designated → remote",
  r({ useLocalDeviceTransport: true, localSessionOwned: false }) === "local" && r({}) === "local" &&
  r({ localSessionOwned: false }) === "remote" && r({ currentSourceIsLocal: false }) === "remote" && r({ canLocalExec: false }) === "remote");

// ── static: the real files are wired exactly like the harness ────────────────────────────────────────────────
const ctx = read("lib", "device-player-context.tsx");
const sm = read("components", "sources-manager.tsx");
const fnBlock = sm.slice(sm.indexOf("const playSyncbizPlaylistExpandedItem"), sm.indexOf("[activePlaylistKey, sources, playlistItemAssignments, setQueue, playSourceOverride, playSource]"));
assert("H: playSyncbizPlaylistExpandedItem passes the real index on ALL 3 CONTROL branches",
  (fnBlock.match(/playSourceOverride\(item, ti\)/g) ?? []).length === 3 && !/playSourceOverride\(item\)/.test(fnBlock) && fnBlock.indexOf("const ti =") < fnBlock.indexOf("if (!activePlaylistKey)"));
const tBlock = ctx.slice(ctx.indexOf("const transportRunsLocally"), ctx.indexOf("const seekOrSend"));
assert("ctx: all 5 transports route through transportRunsLocally (ownership-gated)",
  ["playOrSend", "pauseOrSend", "stopOrSend", "nextOrSend", "prevOrSend"].every((f) => new RegExp(`const ${f} = useCallback\\(\\(\\) => \\{\\n    if \\(transportRunsLocally\\(\\)\\)`).test(tBlock)) &&
  !/useLocalDeviceTransport \|\| localExecCurrent\) (play|pause|stop|next|prev)\(\)/.test(ctx));
assert("ctx: gate includes ownership (localSessionOwnedRef) via routeStationTransport",
  /routeStationTransport\(\{\s*useLocalDeviceTransport,\s*canLocalExec,\s*currentSourceIsLocal,\s*localSessionOwned: localSessionOwnedRef\.current,/.test(tBlock));
assert("ctx: NEXT / PREV step the URL session before the MAIN fallback",
  /else if \(!stepUrlSession\("next"\)\) sendCommandToMaster\("NEXT"\)/.test(tBlock) && /else if \(!stepUrlSession\("prev"\)\) sendCommandToMaster\("PREV"\)/.test(tBlock));
assert("ctx: URL select records the sent leaf + releases ownership; LOCAL select re-acquires + clears it",
  /localSessionOwnedRef\.current = false;[^\n]*\n\s*lastSentUrlLeafRef\.current = source;/.test(ctx) && (ctx.match(/lastSentUrlLeafRef\.current = null;/g) ?? []).length === 2);
assert("F: ownership starts owned (cold-boot restore)", /const localSessionOwnedRef = useRef\(true\);/.test(ctx));
const diff = execSync("git diff HEAD -- lib/device-player-context.tsx components/sources-manager.tsx", { cwd: ROOT }).toString();
assert("G: On-Air (PLAY_INTERRUPT) path unchanged", !/PLAY_INTERRUPT|interrupt/i.test(diff.split("\n").filter((l) => /^[+-][^+-]/.test(l)).join("\n")));
const names = execSync("git diff --name-only HEAD", { cwd: ROOT }).toString();
assert("scope: no desktop / server / playback-provider / audio-player change", !/^(desktop|server)\//m.test(names) && !/playback-provider|audio-player/.test(names));

console.log(`\n${pass} passed, ${fail} failed`);
