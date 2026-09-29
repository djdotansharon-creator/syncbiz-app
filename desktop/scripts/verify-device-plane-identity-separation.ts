/**
 * Phase 0.1 regression — the two Electron device planes must NOT register with the SAME deviceId.
 *
 * In the packaged desktop BOTH register as role:"device":
 *   - MAIN (DeviceWsManager)        → deviceId = config.deviceId  (reconciled to the durable ProgramData id)
 *   - Renderer (useRemoteControlWs) → deviceId = lib/device-id.ts getDeviceId()  (renderer localStorage id)
 * The WS server keys devices in `Map<deviceId, DeviceConnection>` (server/index.ts:860). If both planes used
 * one deviceId, the second REGISTER would OVERWRITE the first socket's entry — orphaning a live socket. So the
 * renderer id MUST stay independent of the durable MAIN station id until the designated-MASTER phase makes the
 * renderer a CONTROL/mirror.
 *
 * Proves: (1) MAIN durable id and renderer id differ; (2) even with the Electron bridge present, the renderer
 * keeps its OWN localStorage id and never adopts the MAIN durable id; (3) lib/device-id.ts has no code path
 * that adopts a durable/machine id from the desktop bridge (guards against silent re-unification).
 *
 * Run: npx tsx desktop/scripts/verify-device-plane-identity-separation.ts
 */
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDurableDeviceId, isValidDeviceId } from "../src/main/durable-device-id";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const roots: string[] = [];
const deviceIdSrcPath = path.join(__dirname, "..", "..", "lib", "device-id.ts");

// ── MAIN plane: the durable station id (isolated ProgramData) ──────────────────────────────────────────────
const pdRoot = mkdtempSync(path.join(os.tmpdir(), "vono-sep-pd-"));
process.env.ProgramData = pdRoot;
roots.push(pdRoot);
const mainId = resolveDurableDeviceId("dsk-MAIN-station").id;
assert("MAIN durable station id resolves", isValidDeviceId(mainId), mainId);

// ── Renderer plane: stub an Electron-like global (bridge present) + a fake localStorage ─────────────────────
type Store = Map<string, string>;
function installRendererGlobals(store: Store): void {
  (globalThis as unknown as { window?: unknown }).window = {
    // Bridge PRESENT (packaged desktop). Post-narrowing, getDeviceId must ignore it for identity.
    syncbizDesktop: { durableDeviceId: mainId },
  };
  (globalThis as unknown as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
}

function loadFreshDeviceIdModule(): { initDeviceId: () => string } {
  const resolved = require.resolve(deviceIdSrcPath);
  delete require.cache[resolved]; // force re-eval so module-level cachedDeviceId resets per scenario
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(resolved) as { initDeviceId: () => string };
}

// Scenario 1 — empty renderer storage in the packaged desktop → generate OWN id, never the MAIN durable id.
{
  const store: Store = new Map();
  installRendererGlobals(store);
  const rendererId = loadFreshDeviceIdModule().initDeviceId();
  assert("renderer generates its own id (bridge present)", rendererId.length > 0 && rendererId !== mainId,
    `renderer=${rendererId} main=${mainId}`);
  assert("renderer id persisted to renderer localStorage (its own, not MAIN's)", store.get("device_id") === rendererId);
  assert("collision guard: two planes → two distinct deviceIds", rendererId !== mainId);
}

// Scenario 2 — renderer storage already holds its own id → reuse it, still independent of MAIN.
{
  const store: Store = new Map([["device_id", "renderer-own-1234-5678"]]);
  installRendererGlobals(store);
  const rendererId = loadFreshDeviceIdModule().initDeviceId();
  assert("renderer reuses its existing localStorage id", rendererId === "renderer-own-1234-5678");
  assert("reused renderer id is not the MAIN durable id", rendererId !== mainId);
}

// Scenario 3 — static guard: lib/device-id.ts must not adopt a durable/machine id from the desktop bridge.
{
  const src = readFileSync(deviceIdSrcPath, "utf-8");
  const adoptsBridgeId = /cachedDeviceId\s*=\s*[^;]*durable/i.test(src) ||
    /return\s+durable/i.test(src) ||
    /syncbizDesktop\s*[^;]*durableDeviceId/i.test(src);
  assert("lib/device-id.ts does not adopt the desktop durable id as the renderer identity", !adoptsBridgeId);
}

for (const r of roots) { try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ } }

console.log(`\n${pass} passed, ${fail} failed`);
