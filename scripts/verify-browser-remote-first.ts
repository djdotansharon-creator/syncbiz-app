/**
 * Owner 2026-11-02 — "the browser first opened as a Player and after loading became a Remote; we said Remote is the default". A plain browser starts as a
 * REMOTE (no "Player" for a moment); the Electron app, the streamer and the deliberate emergency choice keep the MASTER default; the server still decides.
 * Run: npx tsx scripts/verify-browser-remote-first.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

// ── the emergency helper, against a tiny fake window ──
const store = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  addEventListener: (e: string, cb: () => void) => { (listeners.get(e) ?? listeners.set(e, new Set()).get(e)!).add(cb); },
  removeEventListener: (e: string, cb: () => void) => { listeners.get(e)?.delete(cb); },
  dispatchEvent: (ev: { type: string }) => { listeners.get(ev.type)?.forEach((cb) => cb()); return true; },
};
(globalThis as unknown as { Event: unknown }).Event = class { type: string; constructor(t: string) { this.type = t; } };

(async () => {
  const em = await import("../lib/emergency-player");
  let fired = 0;
  const off = em.subscribeEmergencyPlayer(() => { fired++; });
  assert("E1 nothing chosen → not an emergency Player", em.readEmergencyPlayer() === false);
  em.setEmergencyPlayer();
  assert("E2 the deliberate choice is stored AND announced at once (the device context re-reads it in the same tick)", em.readEmergencyPlayer() === true && store.get("vono_emergency_player") === "1" && fired === 1);
  em.clearEmergencyPlayer();
  assert("E3 forgetting it (the browser connected) is announced too", em.readEmergencyPlayer() === false && !store.has("vono_emergency_player") && fired === 2);
  off(); em.setEmergencyPlayer();
  assert("E4 after unsubscribing nothing fires (no leak)", fired === 2);

  // ── the device context ──
  const ctx = rd("lib/device-player-context.tsx");
  assert("C1 a plain browser starts as a REMOTE: CONTROL unless it is the Electron app, the streamer, or the emergency choice",
    /const emergencyPlayer = useSyncExternalStore\(subscribeEmergencyPlayer, readEmergencyPlayer, \(\) => false\);/.test(ctx)
    && /const beforeServerMode: DeviceMode = isElectronShell === false && !isStreamerDevice && !emergencyPlayer \? "CONTROL" : "MASTER";/.test(ctx));
  const eff = ctx.slice(ctx.indexOf("const effectiveDeviceMode ="), ctx.indexOf("const isBranchConnected ="));
  assert("C2 both fallbacks (connected-but-not-assigned, and not connected) use it — no hard-coded MASTER default is left, and the server's answer still wins once connected",
    (eff.match(/lastConnectedModeRef\.current \?\? beforeServerMode/g) ?? []).length === 2 && !/\?\? "MASTER"/.test(eff) && /: deviceMode\n/.test(eff));
  assert("C3 nothing else about the mode logic changed: a mode seen while connected is still remembered; masterReclaimInFlight guard untouched", /lastConnectedModeRef\.current = deviceMode;/.test(ctx) && /\(deviceMode === "CONTROL" && masterReclaimInFlight\)/.test(ctx));

  // ── the veil ──
  const veil = rd("components/connect-veil.tsx");
  assert("C4 the veil uses the helper (stored + announced) instead of writing localStorage itself, and clears it once connected", /setEmergencyPlayer\(\); \/\/ stored \+ announced/.test(veil) && /clearEmergencyPlayer\(\)/.test(veil) && !/localStorage\.(set|remove)Item\(EMERGENCY_PLAYER_KEY/.test(veil) && /export \{ EMERGENCY_PLAYER_KEY \}/.test(veil));
  console.log(`\n${pass} passed, ${fail} failed`);
})();
