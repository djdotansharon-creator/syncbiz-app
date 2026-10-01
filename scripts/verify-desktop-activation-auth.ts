/**
 * Production-grade desktop activation/auth — focused tests (pure helpers + static guards). No DB, no network.
 * Run: npx tsx scripts/verify-desktop-activation-auth.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDesktopAuthClaims, type BuildClaimsDeps } from "../lib/station-device-bind";
import { normalizeEndpointsForPackaged } from "../desktop/src/main/runtime-config-service";
import { sanitizeApplyDesktopAuth } from "../desktop/src/shared/desktop-auth-payload";
import type { RegisterOutcome, RegisterStationDeviceInput } from "../lib/station-device-store";
import type { DesktopRuntimeConfig } from "../desktop/src/shared/mvp-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8");

const PROD_API = "https://syncbiz-app-production.up.railway.app";
const PROD_WS = "wss://syncbiz-ws-production.up.railway.app";

function fakeDeps(outcome: RegisterOutcome, designated: Record<string, string> = {}) {
  const calls: RegisterStationDeviceInput[] = [];
  const deps: BuildClaimsDeps = {
    register: async (i) => { calls.push(i); return { outcome }; },
    getDesignatedMasters: async () => designated,
  };
  return { deps, calls };
}
const DEV = "dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f";

async function main(): Promise<void> {
  // ── buildDesktopAuthClaims: register-FIRST, bind-SECOND ──────────────────────────────────────────────────────
  {
    const { deps, calls } = fakeDeps("created");
    const c = await buildDesktopAuthClaims({ workspaceId: "ws-1", authorizedBranches: ["default"], deviceId: DEV, branchId: "default" }, deps);
    assert("first login + created → token bound with stationDeviceId", c.stationDeviceId === DEV);
    assert("register was called FIRST (before claims)", calls.length === 1 && calls[0].durableDeviceId === DEV && calls[0].workspaceId === "ws-1" && calls[0].branchId === "default");
  }
  {
    const { deps } = fakeDeps("refreshed");
    const c = await buildDesktopAuthClaims({ workspaceId: "ws-1", authorizedBranches: ["default"], deviceId: DEV, branchId: "default" }, deps);
    assert("idempotent repeat (refreshed) → still bound", c.stationDeviceId === DEV);
  }
  {
    const { deps } = fakeDeps("branch_conflict");
    const c = await buildDesktopAuthClaims({ workspaceId: "ws-1", authorizedBranches: ["default"], deviceId: DEV, branchId: "default" }, deps);
    assert("branch_conflict → NOT bound (no stationDeviceId)", c.stationDeviceId === undefined);
  }
  {
    const { deps } = fakeDeps("workspace_conflict");
    const c = await buildDesktopAuthClaims({ workspaceId: "ws-1", authorizedBranches: ["default"], deviceId: DEV, branchId: "default" }, deps);
    assert("workspace_conflict → NOT bound", c.stationDeviceId === undefined);
  }
  {
    const { deps, calls } = fakeDeps("created");
    const c = await buildDesktopAuthClaims({ workspaceId: "ws-1", authorizedBranches: ["default"], deviceId: "short", branchId: "default" }, deps);
    assert("invalid deviceId → no register, no binding", calls.length === 0 && c.stationDeviceId === undefined);
  }
  {
    const { deps, calls } = fakeDeps("created");
    const c = await buildDesktopAuthClaims({ workspaceId: "ws-1", authorizedBranches: ["default"], deviceId: DEV, branchId: "other" }, deps);
    assert("unauthorized branch → no register, no binding", calls.length === 0 && c.stationDeviceId === undefined);
  }
  {
    const { deps } = fakeDeps("created", { default: DEV });
    const c = await buildDesktopAuthClaims({ workspaceId: "ws-1", authorizedBranches: ["default"], deviceId: DEV, branchId: "default" }, deps);
    assert("designatedMasterByBranch embedded from dep", c.designatedMasterByBranch?.default === DEV);
  }
  {
    const { deps } = fakeDeps("created");
    const c = await buildDesktopAuthClaims({ workspaceId: "ws-1", authorizedBranches: ["default"], deviceId: DEV, branchId: "default" }, deps);
    assert("no designation → designatedMasterByBranch omitted", c.designatedMasterByBranch === undefined);
  }

  // ── normalizeEndpointsForPackaged: packaged prod defaults + legacy self-heal + dev localhost ─────────────────
  const baseCfg = (api: string, ws: string): DesktopRuntimeConfig => ({
    deviceId: DEV, branchId: "default", workspaceLabel: "", apiBaseUrl: api, wsUrl: ws, wsToken: "",
    lastAuthEmail: undefined, desktopTokenExpiresAtIso: undefined, musicFolderPath: undefined,
  });
  {
    const r = normalizeEndpointsForPackaged(baseCfg("http://localhost:3000", "ws://localhost:3001"), { packaged: true, prodApiBaseUrl: PROD_API, prodWsUrl: PROD_WS });
    assert("packaged + legacy localhost → prod endpoints", r.changed && r.config.apiBaseUrl === PROD_API && r.config.wsUrl === PROD_WS);
  }
  {
    const r = normalizeEndpointsForPackaged(baseCfg("", ""), { packaged: true, prodApiBaseUrl: PROD_API, prodWsUrl: PROD_WS });
    assert("packaged + empty endpoints → prod", r.changed && r.config.apiBaseUrl === PROD_API && r.config.wsUrl === PROD_WS);
  }
  {
    const custom = "https://staging.example.com";
    const customWs = "wss://staging-ws.example.com";
    const r = normalizeEndpointsForPackaged(baseCfg(custom, customWs), { packaged: true, prodApiBaseUrl: PROD_API, prodWsUrl: PROD_WS });
    assert("packaged + deliberate custom endpoints → UNCHANGED (not overwritten)", !r.changed && r.config.apiBaseUrl === custom && r.config.wsUrl === customWs);
  }
  {
    const r = normalizeEndpointsForPackaged(baseCfg("http://localhost:3000", "ws://localhost:3001"), { packaged: false, prodApiBaseUrl: PROD_API, prodWsUrl: PROD_WS });
    assert("dev / non-packaged → localhost kept (unchanged)", !r.changed && r.config.apiBaseUrl === "http://localhost:3000" && r.config.wsUrl === "ws://localhost:3001");
  }

  // ── sanitizeApplyDesktopAuth: auth-only, cannot carry config/deviceId/endpoints ─────────────────────────────
  {
    const s = sanitizeApplyDesktopAuth({ token: "tok", expiresAtIso: "2026-01-01T00:00:00Z" });
    assert("valid token → ok + token + expiry", s.ok === true && s.ok && s.token === "tok" && s.expiresAtIso === "2026-01-01T00:00:00Z");
  }
  {
    const s = sanitizeApplyDesktopAuth({ token: "   " });
    assert("blank token → error", s.ok === false);
  }
  {
    const s = sanitizeApplyDesktopAuth({} as { token?: unknown });
    assert("missing token → error", s.ok === false);
  }
  {
    // Extra fields (deviceId/apiBaseUrl/wsUrl) MUST be dropped — applyDesktopAuth is auth-only.
    const s = sanitizeApplyDesktopAuth({ token: "tok", deviceId: "evil", apiBaseUrl: "http://evil", wsUrl: "ws://evil" } as { token?: unknown });
    const keys = s.ok ? Object.keys(s).sort().join(",") : "err";
    assert("applyDesktopAuth drops deviceId/apiBaseUrl/wsUrl (auth-only)", keys === "expiresAtIso,ok,token");
  }

  // ── Static guards ───────────────────────────────────────────────────────────────────────────────────────────
  {
    const fromSession = read("app", "api", "auth", "desktop", "token-from-session", "route.ts");
    assert("token-from-session: cookie-authenticated", /getCurrentUserFromCookies\(\)/.test(fromSession) && /status: 401/.test(fromSession));
    assert("token-from-session: ensures StationDevice then mints (register-first)",
      fromSession.indexOf("await ensureStationBoundAndBuildClaims") !== -1 &&
        fromSession.indexOf("await ensureStationBoundAndBuildClaims") < fromSession.indexOf("createDesktopAccessToken(user.id"));
  }
  {
    const pwd = read("app", "api", "auth", "desktop", "token", "route.ts");
    assert("desktop/token: uses register-first helper (no inline findByDurableId)",
      /ensureStationBoundAndBuildClaims/.test(pwd) && !/findByDurableId/.test(pwd));
  }
  {
    const ipc = read("desktop", "src", "main", "ipc-mvp.ts");
    const h = ipc.slice(ipc.indexOf("MVP_IPC.APPLY_DESKTOP_AUTH"), ipc.indexOf("MVP_IPC.MPV_PLAY_URL"));
    assert("APPLY_DESKTOP_AUTH sanitizes the payload", /sanitizeApplyDesktopAuth\(/.test(h));
    assert("APPLY_DESKTOP_AUTH patches ONLY wsToken + desktopTokenExpiresAtIso",
      /patchRuntimeConfig\(getUserData\(\), cur, \{ wsToken: s\.token, desktopTokenExpiresAtIso: s\.expiresAtIso \}\)/.test(h));
    assert("APPLY_DESKTOP_AUTH never reads deviceId/apiBaseUrl/wsUrl from the payload",
      !/payload\.(deviceId|apiBaseUrl|wsUrl)/.test(h) && !/\.apiBaseUrl/.test(h) && !/\.wsUrl/.test(h));
    assert("APPLY_DESKTOP_AUTH reconnects WS without restart", /manager\.connect\(\)/.test(h));
    assert("loadEffectiveRuntimeConfig applies packaged normalization", /normalizeEndpointsForPackaged\(withPro, \{[\s\S]*packaged: app\.isPackaged/.test(ipc));
  }
  {
    const hook = read("lib", "use-desktop-activation.ts");
    assert("renderer hook is Electron-gated (browser no-op)", /if \(!bridge \|\| typeof bridge\.applyDesktopAuth !== "function"/.test(hook));
    assert("renderer hook POSTs same-origin token-from-session + hands token via applyDesktopAuth",
      /\/api\/auth\/desktop\/token-from-session/.test(hook) && /applyDesktopAuth!\(\{ token:/.test(hook));
    assert("renderer hook never logs token", !/console\.(log|info|warn)\([^)]*token/i.test(hook));
  }
  {
    const preload = read("desktop", "src", "preload", "index.ts");
    assert("preload exposes applyDesktopAuth (token+expiry only)", /applyDesktopAuth: \(payload: ApplyDesktopAuthPayload\)/.test(preload) && /token: payload\.token, expiresAtIso: payload\.expiresAtIso/.test(preload));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
}

void main();
