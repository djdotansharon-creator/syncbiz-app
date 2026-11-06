/**
 * Remote SEEK on the desktop station (2026-11-03) — a controller's time-bar drag (phone / browser) reaches MAIN's WS handler as COMMAND SEEK { position }. Until now MAIN had no SEEK
 * case: the command was dropped and the bar snapped back. REAL PlaybackOrchestrator + DeviceWsManager (synthetic MPV events); the audible deck's `seek` is observed.
 * Run (from desktop/): npx tsx scripts/verify-ws-seek.ts
 */
import Module from "node:module";

// the desktop's own node_modules (electron) are not installed in a plain checkout: stub the module the main-process code imports (this test uses no Electron API)
{
  const Mo = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
  const deep: unknown = new Proxy(function () { /* stub */ }, { get: (_t, k) => (k === "then" ? undefined : deep), apply: () => deep, construct: () => deep as object });
  const m = new Module("stub:electron") as unknown as { loaded: boolean; exports: unknown };
  m.loaded = true; m.exports = deep; Mo._cache["stub:electron"] = m;
  const orig = Mo._resolveFilename;
  Mo._resolveFilename = function (r: string, ...rest: unknown[]) { return r === "electron" ? "stub:electron" : orig.call(this, r, ...rest); };
}

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
type Deck = { seek: (s: number) => void; st: { engineReady: boolean } };
type O = { musicDeckA: Deck; musicDeckB: Deck; activeMusicDeck: "A" | "B" };

(async () => {
  const { PlaybackOrchestrator } = await import("../src/main/playback-orchestrator");
  const { DeviceWsManager } = await import("../src/device-websocket-client/device-ws-manager");
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const seeks: string[] = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = true;
    d.seek = (s: number) => { seeks.push(`${id}:${s}`); };
  }
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  const m = mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void };
  const send = (p: unknown) => { seeks.length = 0; m.runTransportCommand("SEEK", p, "ws"); return seeks.slice(); };

  const act = o.activeMusicDeck;
  assert("W1 SEEK { position: 42 } seeks the AUDIBLE deck to 42 s", send({ position: 42 }).join() === `${act}:42`);
  assert("W2 a fractional position and zero are valid (drag to the start)", send({ position: 12.5 }).join() === `${act}:12.5` && send({ position: 0 }).join() === `${act}:0`);
  assert("W3 a missing / non-numeric / negative / non-finite position does nothing (never invents a position)", [undefined, null, {}, { position: "10" }, { position: -1 }, { position: Number.NaN }, { position: Infinity }, "7"].every((p) => send(p).length === 0));
  assert("W4 other commands are unaffected: SET_VOLUME and PAUSE never seek", (() => { seeks.length = 0; m.runTransportCommand("SET_VOLUME", { volume: 50 }, "ws"); m.runTransportCommand("PAUSE", undefined, "ws"); return seeks.length === 0; })());
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log("FAIL  the test threw:", String(e).slice(0, 300)); process.exit(1); });
