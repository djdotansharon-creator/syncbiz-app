/**
 * CONTROL ROOM GATE 3B-4a — retired legacy command routes.
 *
 * Calls the five REAL retired handlers with a request carrying a target / local path / device, while spying on:
 * child_process (exec / execFile / spawn), lib/play-local (runLocalPlaylist / runStopLocal), the agent queue, the
 * in-memory player state, the global log, and console output. No DB, no network.
 * Run: npx tsx scripts/verify-gate3b4a-retired-routes.ts
 */
import Module from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8").replace(/\r\n/g, "\n");

// ── test-process stub: server-only (lib/store → entitlement-limits) ──────────────────────────────────────────
{
  const Mo = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
  const m = new Module("stub:server-only") as unknown as { loaded: boolean; exports: unknown };
  m.loaded = true; m.exports = {}; Mo._cache["stub:server-only"] = m;
  const origResolve = Mo._resolveFilename;
  Mo._resolveFilename = function (r: string, ...rest: unknown[]) { return r === "server-only" ? "stub:server-only" : origResolve.call(this, r, ...rest); };
}

// ── spies: any process execution attempt from route code is recorded ─────────────────────────────────────────
const execCalls: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp = require("node:child_process") as Record<string, unknown>;
for (const fn of ["exec", "execFile", "spawn", "execSync", "spawnSync", "fork"]) {
  const orig = cp[fn] as (...a: unknown[]) => unknown;
  cp[fn] = (...a: unknown[]) => { execCalls.push(`${fn}:${String(a[0])}`); return orig.apply(cp, a); };
}
(globalThis as unknown as { prisma: unknown }).prisma = {}; // lib/store imported only to read the in-memory log

const LOCAL_PATH = "D:\\Secret\\Music\\local-playlist.m3u";
const routes: [string, string, string[]][] = [
  ["player/commands", "../app/api/player/commands/route", ["GET", "POST"]],
  ["play-now", "../app/api/play-now/route", ["POST"]],
  ["commands/play-local", "../app/api/commands/play-local/route", ["POST"]],
  ["commands/stop-local", "../app/api/commands/stop-local/route", ["POST"]],
  ["agent/commands", "../app/api/agent/commands/route", ["GET"]],
];

(async () => {
  const PL = (await import("../lib/play-local")) as unknown as Record<string, unknown>;
  const plCalls: string[] = [];
  for (const fn of ["runLocalPlaylist", "runStopLocal"]) {
    const orig = PL[fn] as (...a: unknown[]) => unknown;
    try { PL[fn] = (...a: unknown[]) => { plCalls.push(fn); return orig(...a); }; } catch { /* ESM namespace: static import check below covers it */ }
  }
  const AQ = await import("../lib/agent-commands");
  AQ.enqueueAgentCommand({ type: "sentinel", payload: {} } as unknown as Parameters<typeof AQ.enqueueAgentCommand>[0]);
  const PS = await import("../lib/player-command-store");
  const stateBefore = JSON.stringify(PS.getAllDevicePlayerStates());
  const { db } = await import("../lib/store");
  const logsBefore = JSON.stringify(db.getLogs());
  const { NextRequest } = await import("next/server");

  const consoleOut: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const capture = (...a: unknown[]) => { consoleOut.push(a.map(String).join(" ")); };
  const statuses: string[] = [];
  const bodies: string[] = [];
  console.log = console.error = console.warn = console.info = capture;
  try {
    for (const [name, mod, methods] of routes) {
      const R = (await import(mod)) as Record<string, (r?: unknown) => Promise<Response>>;
      for (const m of methods) {
        const req = new NextRequest(`http://t.local/api/${name}`, {
          method: m,
          ...(m === "GET" ? {} : { body: JSON.stringify({ action: "play", target: LOCAL_PATH, sourceId: "s1", deviceId: "dev-x", browserPreference: "chrome" }), headers: { "content-type": "application/json" } }),
        });
        const res = await R[m](req);
        statuses.push(`${name}:${m}=${res.status}`);
        bodies.push(await res.text());
      }
    }
  } finally {
    Object.assign(console, orig);
  }

  assert("every retired route + method returns 410", statuses.length === 6 && statuses.every((s) => s.endsWith("=410")), statuses.join(" "));
  assert("minimal JSON body { error: 'Gone' }", bodies.every((b) => b === JSON.stringify({ error: "Gone" })));
  assert("no process execution attempted (exec / execFile / spawn / fork)", execCalls.length === 0, execCalls.join(","));
  assert("runLocalPlaylist / runStopLocal never called", plCalls.length === 0);
  assert("agent queue NOT consumed (sentinel still queued)", JSON.stringify(AQ.consumeNextCommand()).includes("sentinel"));
  assert("in-memory player state unchanged", JSON.stringify(PS.getAllDevicePlayerStates()) === stateBefore);
  assert("global log unchanged (no write)", JSON.stringify(db.getLogs()) === logsBefore);
  assert("no console output at all (target / path / device never echoed)", consoleOut.length === 0, consoleOut.join(" | ").slice(0, 200));
  assert("response never echoes the request target", bodies.every((b) => !b.includes("Secret") && !b.includes("dev-x")));

  // ── static ──────────────────────────────────────────────────────────────────────────────────────────────────
  const routeSrcs = routes.map(([n]) => read("app", "api", ...n.split("/"), "route.ts"));
  assert("retired route files import only next/server", routeSrcs.length === 5 && routeSrcs.every((s) => (s.match(/^import /gm) ?? []).length === 1 && /import \{ NextResponse \} from "next\/server";/.test(s)));
  assert("no play-local / agent-commands / player-command-store / store / child_process import in retired routes",
    routeSrcs.every((s) => !/play-local|agent-commands|player-command-store|lib\/store|child_process|console\./.test(s)));
  const diffName = (p: string) => execSync(`git diff --name-only HEAD -- "${p}"`, { cwd: path.join(__dirname, "..") }).toString().trim();
  assert("beta.10 public routes untouched: jingles/audio + jingles/bell", diffName("app/api/jingles/audio") === "" && diffName("app/api/jingles/bell") === "");
  assert("accepted playback / content routes untouched", ["app/api/playlists", "app/api/sources", "app/api/radio", "app/api/jingles", "app/api/auth", "app/api/devices", "app/api/announcements", "app/api/logs", "lib", "components", "server", "desktop"]
    .every((p) => diffName(p) === ""));
  assert("authz mode still SHADOW", /export const AUTHZ_RUNTIME_MODE: AuthzMode = "shadow";/.test(read("lib", "authz.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
})();
