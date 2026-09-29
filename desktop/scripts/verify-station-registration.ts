/**
 * Phase 0.2A regression — Desktop MAIN station registration (station-device-registration.ts).
 *
 * Pure helpers + StationDeviceRegistrar are exercised with injected fetch/timers/clock/config (no Electron, no
 * network). Plus static guards that registration touches no WS/MASTER/Protection code and never mutates config.
 *
 * Run: npx tsx desktop/scripts/verify-station-registration.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildRegistrationRequest,
  classifyRegistrationStatus,
  computeBackoffMs,
  isTokenDefinitelyExpired,
  registrationRelevantChanged,
  pickRegistrationRelevant,
  registrationSignature,
  StationDeviceRegistrar,
  RETRY_MAX,
  type RegistrationConfigView,
  type RegistrarDeps,
} from "../src/main/station-device-registration";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const repoRoot = path.join(__dirname, "..", "..");
const NOW = 1_800_000_000_000;

function cfg(over: Partial<RegistrationConfigView> = {}): RegistrationConfigView {
  return {
    deviceId: "dsk-abcdef01-2222-4333-8444-555566667777",
    branchId: "default",
    wsToken: "tok-AAAA-BBBB-CCCC",
    apiBaseUrl: "https://app.example.com/",
    desktopTokenExpiresAtIso: undefined,
    ...over,
  };
}

type FetchResult = { status: number; json?: () => Promise<unknown> };
function makeHarness(initial: RegistrationConfigView) {
  let config = initial;
  let responder: (url: string) => Promise<FetchResult> = async () => ({ status: 201, json: async () => ({}) });
  const fetchCalls: { url: string; init: RequestInit | undefined }[] = [];
  const timers: { fn: () => void | Promise<void>; ms: number }[] = [];
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const deps: RegistrarDeps = {
    getConfig: () => config,
    appVersion: "2.2.8",
    platform: "win32",
    fetchImpl: (async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return responder(String(url));
    }) as unknown as typeof fetch,
    now: () => NOW,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); },
    log: (event, fields) => { logs.push({ event, fields }); },
  };
  const registrar = new StationDeviceRegistrar(deps);
  async function drainTimers(max = 12): Promise<void> {
    let n = 0;
    while (timers.length && n < max) { const t = timers.shift()!; await t.fn(); n++; }
  }
  return {
    registrar,
    fetchCalls,
    timers,
    logs,
    drainTimers,
    setResponder: (r: (url: string) => Promise<FetchResult>) => { responder = r; },
    setConfig: (c: RegistrationConfigView) => { config = c; },
    getConfig: () => config,
  };
}
const ok201 = async (): Promise<FetchResult> => ({ status: 201, json: async () => ({}) });
const status = (s: number, err?: string) => async (): Promise<FetchResult> => ({ status: s, json: async () => (err ? { error: err } : {}) });

async function main(): Promise<void> {
  // ── Pure helpers ──────────────────────────────────────────────────────────────────────────────────────────
  {
    const built = buildRegistrationRequest(cfg(), "2.2.8", "win32", NOW);
    if ("skip" in built) { assert("payload builds (not skipped)", false, JSON.stringify(built)); }
    else {
      assert("payload durableDeviceId = effective config deviceId", built.body.durableDeviceId === cfg().deviceId);
      assert("payload has NO workspaceId", !("workspaceId" in built.body));
      assert("payload branchId/platform/appVersion", built.body.branchId === "default" && built.body.platform === "win32" && built.body.appVersion === "2.2.8");
      assert("payload URL is <base>/api/devices/register (trailing slash normalized)", built.url === "https://app.example.com/api/devices/register");
      assert("payload Authorization: Bearer <token>", built.headers.Authorization === "Bearer tok-AAAA-BBBB-CCCC");
    }
  }
  assert("skip: no token", "skip" in buildRegistrationRequest(cfg({ wsToken: "" }), "v", "p", NOW));
  assert("skip: no base", "skip" in buildRegistrationRequest(cfg({ apiBaseUrl: "" }), "v", "p", NOW));
  assert("skip: no deviceId", "skip" in buildRegistrationRequest(cfg({ deviceId: "" }), "v", "p", NOW));

  assert("expiry missing → not expired (attempt)", isTokenDefinitelyExpired(undefined, NOW) === false);
  assert("expiry future → not expired", isTokenDefinitelyExpired(new Date(NOW + 60000).toISOString(), NOW) === false);
  assert("expiry past → expired", isTokenDefinitelyExpired(new Date(NOW - 60000).toISOString(), NOW) === true);
  assert("expiry invalid → not expired (let server decide)", isTokenDefinitelyExpired("not-a-date", NOW) === false);

  assert("classify 201→created", classifyRegistrationStatus(201) === "created");
  assert("classify 200→refreshed", classifyRegistrationStatus(200) === "refreshed");
  assert("classify 401→unauthorized", classifyRegistrationStatus(401) === "unauthorized");
  assert("classify 403→branch_forbidden", classifyRegistrationStatus(403) === "branch_forbidden");
  assert("classify 409→conflict", classifyRegistrationStatus(409) === "conflict");
  assert("classify 500→server_error", classifyRegistrationStatus(503) === "server_error");

  assert("backoff 5/10/20/40", computeBackoffMs(1) === 5000 && computeBackoffMs(2) === 10000 && computeBackoffMs(3) === 20000 && computeBackoffMs(4) === 40000);

  assert("relevant: null → changed", registrationRelevantChanged(null, pickRegistrationRelevant(cfg())));
  assert("relevant: same → unchanged", !registrationRelevantChanged(pickRegistrationRelevant(cfg()), pickRegistrationRelevant(cfg())));
  assert("relevant: branch diff → changed", registrationRelevantChanged(pickRegistrationRelevant(cfg()), pickRegistrationRelevant(cfg({ branchId: "b2" }))));
  assert("relevant: base diff → changed", registrationRelevantChanged(pickRegistrationRelevant(cfg()), pickRegistrationRelevant(cfg({ apiBaseUrl: "https://other/" }))));
  assert("relevant: token diff → changed", registrationRelevantChanged(pickRegistrationRelevant(cfg()), pickRegistrationRelevant(cfg({ wsToken: "tok-2" }))));
  assert("relevant: deviceId-only diff → UNCHANGED (unrelated)", !registrationRelevantChanged(pickRegistrationRelevant(cfg()), pickRegistrationRelevant(cfg({ deviceId: "dsk-other-9999-0000" }))));

  assert("signature never contains the raw token", !registrationSignature(cfg(), "2.2.8").includes("tok-AAAA-BBBB-CCCC"));

  // ── Registrar behavior ────────────────────────────────────────────────────────────────────────────────────
  { // first startup success → one POST
    const h = makeHarness(cfg());
    await h.registrar.runOnce("startup");
    assert("first startup success → exactly one POST", h.fetchCalls.length === 1);
    assert("logs created", h.logs.some((l) => l.event === "station_registration_created"));
    // repeated success trigger (same signature) → zero additional POST
    await h.registrar.runOnce("startup");
    assert("repeated success trigger → no duplicate POST (dedupe)", h.fetchCalls.length === 1);
  }
  { // sign-in with a NEW token → new attempt
    const h = makeHarness(cfg());
    await h.registrar.runOnce("startup");
    h.setConfig(cfg({ wsToken: "tok-NEW" }));
    await h.registrar.runOnce("signin");
    assert("sign-in with new token → new registration POST", h.fetchCalls.length === 2);
  }
  { // branchId change → new attempt; apiBaseUrl change → new attempt
    const h = makeHarness(cfg());
    await h.registrar.runOnce("startup");
    h.setConfig(cfg({ branchId: "branch-2" }));
    await h.registrar.runOnce("config-change");
    assert("branchId change → new POST", h.fetchCalls.length === 2);
    h.setConfig(cfg({ branchId: "branch-2", apiBaseUrl: "https://other.example.com" }));
    await h.registrar.runOnce("config-change");
    assert("apiBaseUrl change → new POST", h.fetchCalls.length === 3);
  }
  { // missing expiry + token → attempts
    const h = makeHarness(cfg({ desktopTokenExpiresAtIso: undefined }));
    await h.registrar.runOnce("startup");
    assert("missing expiry metadata + token → still attempts", h.fetchCalls.length === 1);
  }
  { // explicitly expired token → skipped, no POST
    const h = makeHarness(cfg({ desktopTokenExpiresAtIso: new Date(NOW - 1000).toISOString() }));
    await h.registrar.runOnce("startup");
    assert("explicitly expired token → skipped (no POST)", h.fetchCalls.length === 0);
    assert("expired logs unauthorized/skip", h.logs.some((l) => l.event === "station_registration_unauthorized"));
  }
  { // offline/network failure → bounded retries
    const h = makeHarness(cfg());
    h.setResponder(() => Promise.reject(new Error("offline")));
    await h.registrar.runOnce("startup");
    await h.drainTimers();
    assert("network failure → bounded retries (RETRY_MAX attempts)", h.fetchCalls.length === RETRY_MAX, `attempts=${h.fetchCalls.length}`);
    assert("network failure → retry_exhausted logged, no more timers", h.logs.some((l) => l.event === "station_registration_retry_exhausted") && h.timers.length === 0);
  }
  { // 5xx → bounded retries
    const h = makeHarness(cfg());
    h.setResponder(status(503));
    await h.registrar.runOnce("startup");
    await h.drainTimers();
    assert("5xx → bounded retries (RETRY_MAX)", h.fetchCalls.length === RETRY_MAX);
  }
  for (const s of [401, 403, 409] as const) { // terminal → no retry
    const h = makeHarness(cfg());
    h.setResponder(status(s, s === 409 ? "device is registered to a different branch" : undefined));
    const before = { deviceId: h.getConfig().deviceId, branchId: h.getConfig().branchId };
    await h.registrar.runOnce("startup");
    await h.drainTimers();
    assert(`${s} → exactly one POST, NO retry`, h.fetchCalls.length === 1 && h.timers.length === 0);
    assert(`${s} → no config mutation (deviceId/branchId unchanged)`, h.getConfig().deviceId === before.deviceId && h.getConfig().branchId === before.branchId);
  }
  { // 409 conflict logs, never auto-rebinds (branchId unchanged) — explicit
    const h = makeHarness(cfg({ branchId: "branch-A" }));
    h.setResponder(status(409, "device is registered to a different branch"));
    await h.registrar.runOnce("startup");
    assert("409 → conflict logged", h.logs.some((l) => l.event === "station_registration_conflict"));
    assert("409 → branchId NOT auto-rebound", h.getConfig().branchId === "branch-A");
  }
  { // single in-flight: a second trigger during a pending POST does not start a second POST
    const h = makeHarness(cfg());
    let release!: () => void;
    h.setResponder(() => new Promise<FetchResult>((r) => { release = () => r({ status: 201, json: async () => ({}) }); }));
    const p1 = h.registrar.runOnce("startup");
    await Promise.resolve();
    await h.registrar.runOnce("startup"); // should short-circuit on inFlight
    assert("single in-flight → second trigger starts no second POST", h.fetchCalls.length === 1);
    release();
    await p1;
  }

  // ── Static guards ─────────────────────────────────────────────────────────────────────────────────────────
  const regSrc = readFileSync(path.join(repoRoot, "desktop/src/main/station-device-registration.ts"), "utf-8");
  assert("registration module never references renderer localStorage id", !/localStorage|getDeviceId/.test(regSrc));
  assert("registration module does not import DeviceWsManager", !/device-ws-manager/.test(regSrc));
  assert("registration module does not import server/index", !/server\/index/.test(regSrc));
  assert("registration module never mutates config", !/patchRuntimeConfig|saveRuntimeConfig/.test(regSrc));
  // Guard against actual coupling (imports / fs writes), not prose in the doc comment.
  const regImports = regSrc.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
  assert("registration module imports nothing from Protection/watchdog/heartbeat/paths",
    !/(heartbeat-writer|watchdog|vono-paths|runtime-config-service)/.test(regImports));
  assert("registration module performs no fs writes / ProgramData device-id writes",
    !/writeFileSync|renameSync|device-id\.json/.test(regSrc));

  const dwm = readFileSync(path.join(repoRoot, "desktop/src/device-websocket-client/device-ws-manager.ts"), "utf-8");
  assert("device-ws-manager not wired to registration", !/station-device-registration|\/api\/devices\/register|StationDeviceRegistrar/.test(dwm));

  const server = readFileSync(path.join(repoRoot, "server/index.ts"), "utf-8");
  assert("server/index.ts untouched by registration (no endpoint ref, no Prisma)", !/\/api\/devices\/register/.test(server) && !/@prisma\/client|PrismaClient/.test(server));

  const ipc = readFileSync(path.join(repoRoot, "desktop/src/main/ipc-mvp.ts"), "utf-8");
  const wsConnectIdx = ipc.indexOf("MVP_IPC.WS_CONNECT");
  const wsConnectBlock = ipc.slice(wsConnectIdx, wsConnectIdx + 500);
  assert("WS_CONNECT handler does NOT trigger registration (no reconnect spam)", !/getStationRegistrar|\.trigger\(/.test(wsConnectBlock));
  assert("ipc-mvp wires exactly the 3 triggers (startup/signin/config-change)",
    /trigger\("startup"\)/.test(ipc) && /trigger\("signin"\)/.test(ipc) && /trigger\("config-change"\)/.test(ipc));

  console.log(`\n${pass} passed, ${fail} failed`);
}

void main();
