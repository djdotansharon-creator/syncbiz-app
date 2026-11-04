/**
 * Schedule routing on the designated desktop station (2026-11-04 incident: a scheduled URL playlist played through the
 * renderer's own player on top of MAIN's session → wrong cover / queue on screen and silence at the track's natural end).
 * lib/schedule-station-route.ts (pure) + lib/schedule-playback-client.ts runSchedulePlayback (behavior, fetch mocked) +
 * the wiring guards. Run: npx tsx scripts/verify-schedule-station-route.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { decideScheduleRoute, stationMayStart, type ScheduleRoute } from "../lib/schedule-station-route";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
  else fail++;
}
const read = (f: string) => readFileSync(path.join(__dirname, "..", f), "utf-8");

// ── R: the pure route decision ────────────────────────────────────────────────────────────────────────────────────────
const base = { isDesktopShell: true, mainSnapResolved: true, isDesignatedStation: true, isBranchConnected: true, hasMaster: true };
assert("R1 browser / phone (no desktop bridge) → default (existing behavior, untouched)", decideScheduleRoute({ ...base, isDesktopShell: false }).kind === "default");
assert("R2 desktop, MAIN designation not resolved yet (boot race) → wait — never guess a route", decideScheduleRoute({ ...base, mainSnapResolved: false }).kind === "wait");
assert("R3 desktop, resolved, NOT the designated station → default (unchanged)", decideScheduleRoute({ ...base, isDesignatedStation: false }).kind === "default");
const st = decideScheduleRoute(base);
assert("R4 designated station, cloud WS connected + master known → station, URL ready", st.kind === "station" && st.urlReady === true);
const stOff = decideScheduleRoute({ ...base, isBranchConnected: false });
assert("R5 designated station, cloud WS NOT connected (Dev-PC 5 s after boot / Lenovo after offline boot) → station, URL NOT ready", stOff.kind === "station" && stOff.urlReady === false);
const stNoMaster = decideScheduleRoute({ ...base, hasMaster: false });
assert("R6 designated station, no master known → URL NOT ready (a PLAY_SOURCE would have no addressee)", stNoMaster.kind === "station" && stNoMaster.urlReady === false);
assert("R7 LOCAL target may always start on the station (never needs the cloud)", stationMayStart({ kind: "station", urlReady: false }, "local"));
assert("R8 URL target waits while not ready, starts when ready", !stationMayStart({ kind: "station", urlReady: false }, "youtube") && stationMayStart({ kind: "station", urlReady: true }, "youtube"));

// ── B: runSchedulePlayback behavior (fetch mocked, handlers recorded) ────────────────────────────────────────────────────
type Call = [string, ...unknown[]];
function makeHandlers(route?: ScheduleRoute) {
  const calls: Call[] = [];
  return {
    calls,
    handlers: {
      stop: () => calls.push(["stop"]),
      setQueue: (q: unknown[], o?: unknown) => calls.push(["setQueue", q.length, o]),
      playSource: (s: { id: string; type: string }, i?: number) => calls.push(["playSource", s.id, s.type, i]),
      setLastMessage: () => {},
      ...(route ? { route } : {}),
    },
  };
}
const playlist = {
  id: "p1",
  name: "Morning",
  genre: "Mixed",
  type: "youtube",
  url: "",
  thumbnail: "",
  tracks: [
    { id: "t0", name: "local one", type: "local", url: "" },
    { id: "t1", name: "Bossa 1", type: "youtube", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" },
    { id: "t2", name: "Bossa 2", type: "youtube", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb" },
  ],
};
let fetchCount = 0;
(globalThis as unknown as { fetch: unknown }).fetch = async (u: string) => {
  fetchCount++;
  if (String(u).startsWith("/api/playlists/")) return { ok: true, json: async () => playlist };
  return { ok: false, json: async () => ({}) };
};
const schedule = { id: "s1", targetType: "PLAYLIST", targetId: "p1" } as never;
const router = { push: () => {} };

async function run() {
  const { runSchedulePlayback } = await import("../lib/schedule-playback-client");

  {
    const { calls, handlers } = makeHandlers();
    const ok = await runSchedulePlayback(schedule, null, handlers as never, router);
    assert("B1 default route (no route given) = the existing sequence: stop → queue → play row 0", ok && calls.map((c) => c[0]).join(",") === "stop,setQueue,playSource" && calls[2][3] === 0);
  }
  {
    const { calls, handlers } = makeHandlers({ kind: "station", urlReady: true });
    const ok = await runSchedulePlayback(schedule, null, handlers as never, router);
    assert("B2 station route: NO stop (the current music is never cut first) — queue + play, like a manual click", ok && !calls.some((c) => c[0] === "stop") && calls.map((c) => c[0]).join(",") === "setQueue,playSource");
    assert("B3 station route plays the exact row of the first playable track (row 1, not the LOCAL row 0)", calls[1]?.[3] === 1);
  }
  {
    const { calls, handlers } = makeHandlers({ kind: "station", urlReady: false });
    const ok = await runSchedulePlayback(schedule, null, handlers as never, router);
    assert("B4 station route, URL not ready → returns false and touches NOTHING (current music keeps playing; next poll retries)", ok === false && calls.length === 0);
  }
  {
    const before = fetchCount;
    const { calls, handlers } = makeHandlers({ kind: "wait", reason: "station-deciding" });
    const ok = await runSchedulePlayback(schedule, null, handlers as never, router);
    assert("B5 wait route → returns false before any fetch or playback call", ok === false && calls.length === 0 && fetchCount === before);
  }

  // ── W: wiring ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const hooks = read("lib/use-schedule-playback-handlers.ts");
  assert("W1 the station route plays through device.playSourceOrSend (the manual-click path), every other route through the existing routed play", /route\.kind === "station" && stationPlay \? stationPlay : routedPlaySource/.test(hooks) && /const stationPlay = device\?\.playSourceOrSend;/.test(hooks));
  assert("W2 the route is fed by the designation signals of device-player-context (mainSnapResolved, isDesignatedAudioStation, isBranchConnected, masterDeviceId)", /device\?\.mainSnapResolved/.test(hooks) && /device\?\.isDesignatedAudioStation/.test(hooks) && /device\?\.isBranchConnected/.test(hooks) && /device\?\.masterDeviceId/.test(hooks));
  const auto = read("components/schedule-auto-player.tsx");
  assert("W3 the auto-player skips a tick while the route is 'wait' and passes the route to runSchedulePlayback (fired-today is set only on success)", /handlersRef\.current\.route\?\.kind === "wait"\) return;/.test(auto) && /route: h\.route \}/.test(auto) && /if \(!ok\) return;\s*\n\s*const fireKey/.test(auto));
  const card = read("components/schedule-card.tsx");
  assert("W4 'Play now' uses the same route", /\{ stop, setQueue, playSource, setLastMessage, route \}/.test(card));
  const routed = read("lib/use-routed-play-source.ts");
  assert("W5 lib/use-routed-play-source.ts is unchanged (other windows keep their routing)", /if \(device\?\.isBranchConnected && device\.deviceMode === "CONTROL"\) \{/.test(routed));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
void run();
