/**
 * OFFLINE COLD BOOT — MAIN station WS starts independently of the hosted renderer.
 *  #13 startup with persisted token+wsUrl → connect attempted (static wiring + real manager REGISTERs)
 *  #14 MAIN offline → the existing reconnect loop stays armed (real manager vs a closed port)
 *  #15 APPLY_DESKTOP_AUTH while already REGISTERED+connected → NO disconnect / re-register (real manager + local
 *      WS server; the guard predicate is asserted to be exactly what ipc-mvp uses)
 * Uses a LOCAL ws server on 127.0.0.1 only (no TEST/PROD). The server never sends SET_DEVICE_MODE, so the
 * designation cache is never written.
 *
 * Run (from desktop/): npx tsx scripts/verify-main-ws-startup-connect.ts
 */
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { WebSocketServer } from "ws";
import { DeviceWsManager } from "../src/device-websocket-client/device-ws-manager";
import type { DesktopRuntimeConfig } from "../src/shared/mvp-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "..", ...p), "utf-8").replace(/\r\n/g, "\n");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
const cfg = (wsUrl: string): DesktopRuntimeConfig =>
  ({ wsUrl, wsToken: "test-token-not-a-secret", deviceId: "dsk-test-0000", branchId: "default" } as unknown as DesktopRuntimeConfig);
/** EXACT predicate used by ipc-mvp APPLY_DESKTOP_AUTH (asserted statically below). */
const alreadyRegistered = (st: { registered?: boolean; wsState?: string }) => st.registered === true && st.wsState === "connected";

(async () => {
  // ── static wiring (ipc-mvp) ───────────────────────────────────────────────────────────────────────────────
  const ipc = read("desktop", "src", "main", "ipc-mvp.ts");
  const reg = ipc.slice(ipc.indexOf("export function registerMvpIpc("));
  const regHead = reg.slice(0, reg.indexOf("ipcMain.handle("));
  assert("#13 startup connect gated on persisted wsToken + wsUrl",
    /if \(\(cachedConfig\.wsToken \?\? ""\)\.trim\(\) && \(cachedConfig\.wsUrl \?\? ""\)\.trim\(\)\) \{\s*manager\.connect\(\);/.test(regHead));
  assert("#13 startup connect happens right after the manager is created (before any IPC handler)",
    regHead.indexOf("manager = new DeviceWsManager(cachedConfig, orchestratorInstance);") < regHead.indexOf("manager.connect();"));
  assert("#13 startup uses the reconciled effective config (durable id)", /cachedConfig = loadEffectiveRuntimeConfig\(\);/.test(regHead));
  const apply = ipc.slice(ipc.indexOf("ipcMain.handle(MVP_IPC.APPLY_DESKTOP_AUTH"));
  const applyBody = apply.slice(0, apply.indexOf("\n  });"));
  assert("#15 APPLY always stores the fresh token (patchRuntimeConfig + setConfig)",
    /patchRuntimeConfig\(getUserData\(\), cur, \{ wsToken: s\.token/.test(applyBody) && /manager\.setConfig\(next\);/.test(applyBody));
  assert("#15 APPLY guard predicate = registered && wsState==='connected'",
    /const alreadyRegistered = st\.registered === true && st\.wsState === "connected";/.test(applyBody));
  assert("#15 APPLY connects ONLY when not already registered",
    /if \(!alreadyRegistered\) manager\.connect\(\);/.test(applyBody) && (applyBody.match(/manager\.connect\(\)/g) ?? []).length === 1);
  const mgrSrc = read("desktop", "src", "device-websocket-client", "device-ws-manager.ts");
  assert("DeviceWsManager reconnect semantics unchanged (scheduleReconnect on abnormal close)",
    /if \(!this\.intentionalClose\) this\.scheduleReconnect\(\);/.test(mgrSrc));

  // ── #14 offline: closed port → reconnect loop armed, no crash ────────────────────────────────────────────
  {
    const port = await freePort(); // nothing listens here
    const m = new DeviceWsManager(cfg(`ws://127.0.0.1:${port}`));
    m.connect();
    await sleep(600);
    const internals = m as unknown as { reconnectTimer: unknown; intentionalClose: boolean };
    assert("#14 offline connect fails → reconnect timer armed", internals.reconnectTimer !== null && internals.intentionalClose === false);
    assert("#14 offline: not registered, playback state untouched (no false idle reset needed)", m.snapshot().registered === false);
    m.disconnect();
    assert("intentional disconnect cancels the loop", internals.reconnectTimer === null && internals.intentionalClose === true);
  }

  // ── #13 / #15 behavioral: real manager ↔ local ws server ─────────────────────────────────────────────────
  {
    const port = await freePort();
    const wss = new WebSocketServer({ host: "127.0.0.1", port });
    let connections = 0, closes = 0, registers = 0;
    let lastRegister: { deviceId?: string; branchId?: string } = {};
    wss.on("connection", (sock) => {
      connections++;
      sock.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === "REGISTER") {
          registers++;
          lastRegister = { deviceId: msg.deviceId, branchId: msg.branchId };
          sock.send(JSON.stringify({ type: "REGISTERED" }));
        }
      });
      sock.on("close", () => closes++);
    });
    const m = new DeviceWsManager(cfg(`ws://127.0.0.1:${port}`));
    m.connect(); // what registerMvpIpc now does at startup when token+wsUrl are persisted
    await sleep(500);
    assert("#13 startup connect REGISTERs with the persisted durable identity",
      registers === 1 && lastRegister.deviceId === "dsk-test-0000" && lastRegister.branchId === "default");
    assert("#13 manager reports registered + connected", alreadyRegistered(m.snapshot()));

    // Renderer later sends APPLY_DESKTOP_AUTH with a FRESH token: store it, and (guard) do not reconnect.
    m.setConfig({ ...cfg(`ws://127.0.0.1:${port}`), wsToken: "fresh-token-not-a-secret" } as DesktopRuntimeConfig);
    if (!alreadyRegistered(m.snapshot())) m.connect();
    await sleep(500);
    assert("#15 APPLY while registered → no disconnect", closes === 0, `closes=${closes}`);
    assert("#15 APPLY while registered → no second socket / re-REGISTER", connections === 1 && registers === 1);
    assert("#15 still registered + connected after APPLY", alreadyRegistered(m.snapshot()));

    // Contrast: an UNGUARDED connect() would drop and re-register the healthy designated socket.
    m.connect();
    await sleep(500);
    assert("(contrast) unguarded connect() would cause a disconnect + re-REGISTER", closes === 1 && registers === 2);

    // Not registered (e.g. server gone → backoff) → APPLY must connect immediately.
    m.disconnect();
    await sleep(100);
    assert("not registered → guard allows an immediate connect", !alreadyRegistered(m.snapshot()));
    m.disconnect();
    wss.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
})();
