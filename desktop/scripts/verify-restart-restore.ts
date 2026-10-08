/**
 * P0 Gate 2d (owner rule 2026-10-09) — restart restore: the station REMEMBERS its last source (URL playlist or LOCAL)
 * across shutdown / restart / crash with NO age limit, until someone changes it. Boot online → the remembered URL
 * playlist returns (MAIN); boot offline → LOCAL plays (no silence) and, once the network is stable, the URL source
 * returns at the LOCAL track's mix point (never cutting the music mid-track). A manual choice replaces the restore.
 * REAL PlaybackOrchestrator + DeviceWsManager (synthetic MPV events; the store on a temp file; the probe stubbed).
 * Run (from desktop/): npx tsx scripts/verify-restart-restore.ts
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { DeviceWsManager, setUrlPlaybackPrefs } from "../src/device-websocket-client/device-ws-manager";
import { readPlaybackSource, writePlaybackSource, setPlaybackSourcePathForTests } from "../src/main/playback-source-store";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; play: (u: string, id?: number) => void; preloadPaused: (u: string, id?: number) => void; resume: () => void };
type O = { musicDeckA: Deck; musicDeckB: Deck; activeMusicDeck: "A" | "B"; settleXfadeNow: (r: string) => void };
type Mirror = { currentTrack?: { title?: string } | null; currentTrackIndex?: number; playNextQueue?: Array<{ id: string; title: string }> };
const urlOf = (i: number) => `https://www.youtube.com/watch?v=pl${String(i).padStart(9, "0")}`;
const qUrl = (i: number) => `https://www.youtube.com/watch?v=qq${String(i).padStart(9, "0")}`;
const tracks = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, title: `Track ${i}`, cover: null, url: urlOf(i) }));
const payload = (i: number) => ({ source: { id: `pl:track:r${i}`, title: `Track ${i}`, url: urlOf(i), type: "youtube", origin: "playlist", playlistId: "pl", sessionTracks: tracks }, trackIndex: i });
const dropUrl = (i: number) => ({ source: { id: `url-${i}`, title: `Dropped ${i}`, url: qUrl(i), type: "youtube", origin: "source" } });
const localSession = (intent?: "user") => ({ source: { id: "local-pl", title: "Local", type: "local", url: "", origin: "playlist", sessionTracks: [{ id: "a", title: "L A", cover: null }, { id: "b", title: "L B", cover: null }] }, trackIndex: 0, ...(intent ? { intent } : {}) });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const dir = mkdtempSync(path.join(os.tmpdir(), "vono-g2d-"));
let fileSeq = 0;
function freshStore(): string {
  const p = path.join(dir, `playback-source-${++fileSeq}.json`);
  setPlaybackSourcePathForTests(p);
  return p;
}
const savedUrlRecord = (index: number, playNext: Array<{ qid: string; id: string; title: string; cover: null; url: string }> = []) => ({
  kind: "url" as const,
  url: { items: tracks, index, shell: "pl", sourceId: `pl:track:r${index}`, origin: "playlist" as const, sourceType: "youtube", sessionTitle: "Track", sessionPlaylistId: "pl", playNext },
});

function world(opts: { designated?: boolean; online?: boolean; engineReady?: boolean } = {}) {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const calls: string[] = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = opts.engineReady !== false;
    const pl = d.play.bind(d), pre = d.preloadPaused.bind(d), rs = d.resume.bind(d);
    d.play = (u, a) => { calls.push(`${id}:play:${u}`); pl(u, a); };
    d.preloadPaused = (u, a) => { calls.push(`${id}:prepare:${u}`); pre(u, a); };
    d.resume = () => { calls.push(`${id}:resume`); rs(); };
  }
  // MPV reports "IPC ready" through a status event in production — emit one so the orchestrator state carries it
  if (opts.engineReady !== false) o.musicDeckA.handleEvent({ event: "property-change", name: "volume", data: 100 });
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  const mi = mgr as unknown as {
    offlineDesignated: boolean; probeNetwork: () => Promise<boolean>; onNetworkStable: () => void; pendingRestore: unknown;
    runTransportCommand: (c: string, p: unknown, s: string) => void; mock: { getState: () => Mirror };
  };
  mi.offlineDesignated = opts.designated !== false;
  let online = opts.online !== false;
  mi.probeNetwork = async () => online;
  const toMain = (cmd: string, p?: unknown) => mi.runTransportCommand(cmd, p, "ws");
  const deck = (id: "A" | "B") => (id === "A" ? o.musicDeckA : o.musicDeckB);
  const active = () => deck(o.activeMusicDeck);
  const standby = () => deck(o.activeMusicDeck === "A" ? "B" : "A");
  const at = (d: Deck, sec: number) => d.handleEvent({ event: "property-change", name: "time-pos", data: sec });
  const startPlaying = (d: Deck, dur = 200) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: dur }); d.handleEvent({ event: "file-loaded" }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); at(d, 1); at(d, 2); };
  const preparedLoads = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 200 }); d.handleEvent({ event: "file-loaded" }); };
  const resumes = (d: Deck) => { d.handleEvent({ event: "property-change", name: "pause", data: false }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); at(d, 1); at(d, 2); };
  const finishRamp = () => o.settleXfadeNow("test: complete the ramp");
  const nowTitle = () => mi.mock.getState().currentTrack?.title ?? null;
  const queueTitles = () => (mi.mock.getState().playNextQueue ?? []).map((q) => q.title).join(",");
  const lastPrepared = () => { const l = calls.filter((c) => c.includes(":prepare:")).pop(); return l ? l.slice(l.indexOf("https")) : null; };
  const plays = () => calls.filter((c) => c.includes(":play:"));
  const boot = async () => { mgr.enableSourcePersistence({ probeUrl: "http://probe.test/api/health", bootRestore: true }); await tick(); await tick(); };
  return { orch, o, calls, mgr, mi, toMain, deck, active, standby, at, startPlaying, preparedLoads, resumes, finishRamp, nowTitle, queueTitles, lastPrepared, plays, boot, setOnline: (v: boolean) => { online = v; } };
}
setUrlPlaybackPrefs({ autoMix: true, repeatMode: "playlist" });

async function main(): Promise<void> {
  // ── the store ──
  {
    const p = freshStore();
    assert("F1 nothing saved → null (the station behaves as before)", readPlaybackSource() === null);
    writePlaybackSource(savedUrlRecord(3));
    const r = readPlaybackSource();
    assert("F2 a URL source round-trips (items, index, title)", r?.kind === "url" && r.url?.index === 3 && r.url.items.length === 5 && r.url.sessionTitle === "Track");
    writePlaybackSource({ kind: "url", url: { ...savedUrlRecord(0).url, items: [{ id: "x", title: "X", cover: null, url: "C:\\music\\x.mp3" }, tracks[1]] } });
    const raw = readFileSync(p, "utf-8");
    assert("F3 a local filesystem path is NEVER written (CLAUDE.md §12)", !raw.includes("C:\\\\music") && !raw.includes("x.mp3"));
    writeFileSync(p, "{ not json");
    assert("F4 a corrupt file → null (never a crash)", readPlaybackSource() === null);
    const old = { schemaVersion: 1, updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 400, ...savedUrlRecord(2) };
    writeFileSync(p, JSON.stringify(old));
    assert("F5 NO age limit — a 400-day-old source is still restored", readPlaybackSource()?.url?.index === 2);
  }

  // ── boot: nothing saved / not designated ──
  {
    freshStore();
    const w = world();
    await w.boot();
    assert("B1 nothing saved → bootSource 'local' (the renderer's normal LOCAL restore); MAIN plays nothing", w.mgr.snapshot().bootSource === "local" && w.plays().length === 0);
    w.orch.kill();
  }
  {
    freshStore(); writePlaybackSource(savedUrlRecord(2));
    const w = world({ designated: false });
    await w.boot();
    assert("B2 NOT the designated station → no automatic restore at all (never starts audio by itself)", w.mgr.snapshot().bootSource === "none" && w.plays().length === 0);
    w.orch.kill();
  }

  // ── boot ONLINE with a remembered URL playlist ──
  {
    freshStore(); writePlaybackSource(savedUrlRecord(2, [{ qid: "pn-4", id: "url-1", title: "Dropped 1", cover: null, url: qUrl(1) }]));
    const w = world();
    w.mgr.enableSourcePersistence({ probeUrl: "http://probe.test/api/health", bootRestore: true });
    assert("O1 while the network probe runs → bootSource 'deciding' (the renderer waits)", w.mgr.snapshot().bootSource === "deciding");
    await tick(); await tick();
    assert("O2 online → bootSource 'url'; MAIN plays the remembered track (Track 2)", w.mgr.snapshot().bootSource === "url" && w.plays().some((c) => c.endsWith(urlOf(2))) && w.nowTitle() === "Track 2", `${w.mgr.snapshot().bootSource} | ${w.plays().join(" ")} | ${w.nowTitle()}`);
    assert("O3 the remembered Play Next queue is back", w.queueTitles() === "Dropped 1");
    w.startPlaying(w.active());
    assert("O4 MAIN owns the restored session's automatic progression (Gate 2c)", w.mgr.snapshot().mainUrlAutoAdvance === true);
    w.at(w.active(), 150);
    assert("O5 … the queued item is prepared next, then the playlist continues (Drop Next unchanged)", w.lastPrepared() === qUrl(1), String(w.lastPrepared()));
    w.orch.kill();
  }
  {
    freshStore(); writePlaybackSource(savedUrlRecord(1));
    const w = world({ engineReady: false });
    await w.boot();
    assert("O6 online but MPV not ready yet → nothing loaded yet (waits for the engine, no failure)", w.plays().length === 0 && w.mgr.snapshot().bootSource === "url");
    w.o.musicDeckA.st.engineReady = true; w.o.musicDeckB.st.engineReady = true;
    w.active().handleEvent({ event: "property-change", name: "volume", data: 100 });
    assert("O7 engine ready → the remembered track starts", w.plays().some((c) => c.endsWith(urlOf(1))), w.plays().join(" | "));
    w.orch.kill();
  }

  // ── boot OFFLINE: LOCAL fallback, then the URL returns at the LOCAL mix point ──
  {
    const p = freshStore(); writePlaybackSource(savedUrlRecord(3));
    const w = world({ online: false });
    await w.boot();
    assert("X1 offline → bootSource 'url-pending'; MAIN plays nothing (the renderer starts its LOCAL fallback)", w.mgr.snapshot().bootSource === "url-pending" && w.plays().length === 0);
    // the renderer's LOCAL fallback (engine + metadata push WITHOUT a user intent)
    w.orch.playMusic("C:\\music\\one.mp3", 7); w.startPlaying(w.active());
    w.toMain("PLAY_SOURCE", localSession());
    assert("X2 the LOCAL fallback keeps the remembered URL source (file unchanged, restore still pending)", w.mi.pendingRestore !== null && readPlaybackSource()?.kind === "url");
    w.setOnline(true);
    w.mi.onNetworkStable();
    assert("X3 network stable → the URL source is ARMED over the audible LOCAL track (nothing cut; renderer keeps LOCAL)", w.mgr.snapshot().queueWatchesLocal === true && w.mgr.snapshot().bootSource === "url-pending" && w.plays().length === 1 && w.nowTitle() !== "Track 3");
    w.at(w.active(), 150);
    assert("X4 ~60 s before the LOCAL end the remembered URL track is prepared", w.lastPrepared() === urlOf(3));
    w.preparedLoads(w.standby()); w.at(w.active(), 192); w.resumes(w.standby()); w.finishRamp();
    const snap = w.mgr.snapshot();
    assert("X5 at the LOCAL mix point the remembered URL track takes over (crossfade) → Track 3",
      w.nowTitle() === "Track 3" && snap.bootSource === "url" && typeof snap.restoreTakeoverAttemptId === "number" && snap.restoreTakeoverAttemptId === snap.mpvAttemptId);
    assert("X6 after the take-over MAIN owns the URL session (renderer released)", snap.mainUrlAutoAdvance === true && snap.queueWatchesLocal === false);
    assert("X7 the remembered source is still the URL playlist", existsSync(p) && readPlaybackSource()?.kind === "url");
    w.orch.kill();
  }
  {
    freshStore(); writePlaybackSource(savedUrlRecord(0));
    const w = world({ online: false });
    await w.boot();
    w.setOnline(true);
    w.mi.onNetworkStable();
    assert("X8 offline boot with NO LOCAL fallback audible → the URL source starts as soon as the network is stable", w.plays().some((c) => c.endsWith(urlOf(0))) && w.nowTitle() === "Track 0", `${w.plays().join(" ")} | ${w.nowTitle()}`);
    w.orch.kill();
  }

  // ── a manual choice replaces the restore ──
  {
    freshStore(); writePlaybackSource(savedUrlRecord(3));
    const w = world({ online: false });
    await w.boot();
    w.orch.playMusic("C:\\music\\one.mp3", 7); w.startPlaying(w.active());
    w.toMain("PLAY_SOURCE", localSession());
    w.toMain("PLAY_SOURCE", localSession("user"));
    assert("M1 the user CHOOSES LOCAL → the pending URL restore is cancelled; LOCAL is the remembered source", w.mi.pendingRestore === null && readPlaybackSource()?.kind === "local" && w.mgr.snapshot().bootSource === "local");
    w.mi.onNetworkStable();
    assert("M2 … the network returning later changes nothing", w.plays().length === 1 && w.mgr.snapshot().queueWatchesLocal === false);
    w.orch.kill();
  }
  {
    freshStore(); writePlaybackSource(savedUrlRecord(3));
    const w = world({ online: false });
    await w.boot();
    w.orch.playMusic("C:\\music\\one.mp3", 7); w.startPlaying(w.active());
    w.toMain("PLAY_SOURCE", localSession());
    w.setOnline(true); w.mi.onNetworkStable();
    w.toMain("PLAY_SOURCE", payload(1));
    const s = readPlaybackSource();
    assert("M3 the user selects another URL while the restore is armed → that selection plays and is remembered", w.nowTitle() === "Track 1" && s?.kind === "url" && s.url?.index === 1 && w.mgr.snapshot().restoreTakeoverAttemptId === 0);
    w.orch.kill();
  }

  // ── what is remembered while playing ──
  {
    freshStore();
    const w = world();
    w.mgr.enableSourcePersistence({ probeUrl: "", bootRestore: false });
    w.toMain("PLAY_SOURCE", payload(0)); w.startPlaying(w.active());
    assert("P1 a URL selection is remembered (index 0)", readPlaybackSource()?.url?.index === 0);
    w.at(w.active(), 150); w.preparedLoads(w.standby()); w.at(w.active(), 192); w.resumes(w.standby()); w.finishRamp();
    assert("P2 the automatic advance updates the remembered position (index 1)", readPlaybackSource()?.url?.index === 1 && w.nowTitle() === "Track 1");
    w.toMain("QUEUE_NEXT", dropUrl(5));
    assert("P3 a dropped item is remembered in the Play Next queue", readPlaybackSource()?.url?.playNext.map((q) => q.title).join() === "Dropped 5");
    const qid = readPlaybackSource()?.url?.playNext[0]?.qid;
    w.toMain("QUEUE_REMOVE", { queueItemId: qid });
    assert("P4 removing it updates the remembered queue", readPlaybackSource()?.url?.playNext.length === 0);
    w.toMain("PLAY_SOURCE", localSession("user"));
    assert("P5 choosing LOCAL → the remembered source is LOCAL", readPlaybackSource()?.kind === "local");
    w.orch.kill();
  }

  {
    freshStore(); writePlaybackSource(savedUrlRecord(1));
    const w = world();
    await w.boot();
    w.startPlaying(w.active());
    w.toMain("PLAY_SOURCE", localSession("user"));
    assert("P6 after a URL boot restore the user chooses LOCAL → bootSource 'local' (a renderer reload restores LOCAL, never skipped)", w.mgr.snapshot().bootSource === "local" && readPlaybackSource()?.kind === "local");
    w.orch.kill();
  }

  // ── static pins: renderer + wiring ──
  const rd = (p: string) => readFileSync(path.join(__dirname, "..", "..", p), "utf-8").replace(/\r\n/g, "\n");
  const prov = rd("lib/playback-provider.tsx"), dpc = rd("lib/device-player-context.tsx"), ipc = rd("desktop/src/main/ipc-mvp.ts"), mgrSrc = rd("desktop/src/device-websocket-client/device-ws-manager.ts");
  assert("S1 provider waits for MAIN's decision ('deciding') and skips its LOCAL restore when MAIN restores the URL", /mainBootSource\.current === "deciding"/.test(prov) && /if \(mainBootSource\.current === "url"\) \{/.test(prov));
  assert("S2 provider: offline boot → the station's last LOCAL session is the fallback", /mainBootSource\.current === "url-pending" && !persistedV2\?\.local/.test(prov) && /loadPersistedPlaybackV2\(LAST_LOCAL_STORAGE_KEY\)/.test(prov));
  assert("S3 provider: no age limit on a desktop station", /!isDesktopStationShell\(\) && Date\.now\(\) - updatedAt > RECOVERY_TTL_MS/.test(prov));
  assert("S4 renderer tags an explicit LOCAL selection (intent 'user') and releases LOCAL on the take-over", (dpc.match(/localUserIntentRef\.current = true;/g) ?? []).length === 2 && /takeover === snapAttempt && restoreTakeoverSeenRef\.current !== takeover/.test(dpc));
  assert("S5 MAIN wiring: persistence + boot restore at startup, probe = the app server's /api/health", /manager\.enableSourcePersistence\(\{ probeUrl: stationProbeUrl\(cachedConfig\.apiBaseUrl\), bootRestore: true \}\);/.test(ipc) && /\$\{base\}\/api\/health/.test(ipc));
  assert("S6 the network must be stable (2 consecutive probes, 30 s apart) before the URL returns", /if \(this\.restoreNetOk >= 2\) this\.onNetworkStable\(\);/.test(mgrSrc) && /\}, 30_000\);/.test(mgrSrc));

  setPlaybackSourcePathForTests(null);
  console.log(`\n${pass} passed, ${fail} failed`);
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
