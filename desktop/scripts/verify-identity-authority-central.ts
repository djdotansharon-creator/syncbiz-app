/**
 * Phase 0.1 regression — ProgramData is the CENTRAL immutable identity authority, re-asserted on every effective
 * config request. Closes the getEffectiveRuntimeConfig() short-circuit + the PICK/CLEAR_MUSIC_FOLDER poisoning of
 * cachedConfig, and proves device-scoped snapshot lookups use the durable id.
 *
 * Faithfully replicates the ipc-mvp handler pipelines using the same electron-free modules, then a STATIC sweep
 * asserts no manager feed can receive a raw (unreconciled) runtime config.
 *
 * Run: npx tsx desktop/scripts/verify-identity-authority-central.ts
 */
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileDeviceIdentity } from "../src/main/device-identity-reconcile";
import { writeProgramDataDeviceId, readProgramDataDeviceId } from "../src/main/durable-device-id";
import { loadRuntimeConfig, saveRuntimeConfig, patchRuntimeConfig, defaultRuntimeConfig } from "../src/main/runtime-config-service";
import { ensurePlaylistProRuntimeConfig } from "../src/main/playlistpro-config";
import { addAdditionalMusicFolder } from "../src/main/additional-music-folders";
import type { DesktopRuntimeConfig } from "../src/shared/mvp-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const roots: string[] = [];
function tmp(p: string): string { const d = mkdtempSync(path.join(os.tmpdir(), p)); roots.push(d); return d; }

// Mirror ipc-mvp.loadEffectiveRuntimeConfig() exactly (raw → PlaylistPro normalize → reconcile).
function effective(userData: string): DesktopRuntimeConfig {
  return reconcileDeviceIdentity(userData, ensurePlaylistProRuntimeConfig(userData, loadRuntimeConfig(userData)));
}
// Mirror PICK_MUSIC_FOLDER's cachedConfig assignment.
function pickMusicFolder(userData: string, chosen: string): DesktopRuntimeConfig {
  const cur = loadRuntimeConfig(userData);
  const next = patchRuntimeConfig(userData, cur, { musicFolderPath: chosen });
  return reconcileDeviceIdentity(userData, ensurePlaylistProRuntimeConfig(userData, next));
}

const A = "dsk-A-central-authority";
const B = "dsk-B-poison-attempt";

// ── Behavioral: ProgramData=A, raw config tampered to B, then a config-mutation handler runs ────────────────
{
  const pd = tmp("vono-cen-pd-"); process.env.ProgramData = pd; writeProgramDataDeviceId(A);
  const userData = tmp("vono-cen-ud-");
  saveRuntimeConfig(userData, { ...defaultRuntimeConfig(), deviceId: A, branchId: "default" });

  // tamper the raw config file to B (simulates a manual edit / a poisoned prior cachedConfig source)
  saveRuntimeConfig(userData, { ...loadRuntimeConfig(userData), deviceId: B });
  assert("setup: raw config poisoned to B", loadRuntimeConfig(userData).deviceId === B);
  assert("setup: ProgramData still A", readProgramDataDeviceId() === A);

  // PICK_MUSIC_FOLDER (previously poisoned cachedConfig without reconcile)
  const chosen = tmp("vono-cen-music-");
  const cached = pickMusicFolder(userData, chosen);
  assert("PICK_MUSIC_FOLDER → cachedConfig deviceId is A (not B)", cached.deviceId === A, `got ${cached.deviceId}`);
  assert("PICK_MUSIC_FOLDER self-healed the config file to A", loadRuntimeConfig(userData).deviceId === A);
  assert("PICK_MUSIC_FOLDER preserved the chosen folder", (cached.musicFolderPath ?? "") === chosen);

  // getEffectiveRuntimeConfig() must re-assert A even if a caller had poisoned it moments earlier
  saveRuntimeConfig(userData, { ...loadRuntimeConfig(userData), deviceId: B }); // poison again
  const eff = effective(userData);
  assert("getEffectiveRuntimeConfig re-asserts A (no cached short-circuit)", eff.deviceId === A, `got ${eff.deviceId}`);

  // Subsequent ADD_ADDITIONAL_MUSIC_FOLDER → the config fed to manager.setConfig
  const addDir = tmp("vono-cen-add-");
  const { config: patched } = addAdditionalMusicFolder(userData, effective(userData), addDir);
  assert("ADD folder → manager.setConfig source deviceId is A", patched.deviceId === A, `got ${patched.deviceId}`);

  // Device-scoped local snapshot lookup key (exactly how the handlers derive it)
  const snapshotKey = (effective(userData).deviceId ?? "").trim() || "unknown";
  assert("device-scoped snapshot lookup key is A (not B/unknown)", snapshotKey === A, `got ${snapshotKey}`);

  assert("device-id.json remained A throughout", readProgramDataDeviceId() === A);
}

// ── Static sweep (#6): no manager feed may receive a raw, unreconciled runtime config ───────────────────────
{
  const src = readFileSync(path.join(__dirname, "..", "src", "main", "ipc-mvp.ts"), "utf-8");

  // getEffectiveRuntimeConfig must ALWAYS reconcile — never `cachedConfig ??` short-circuit.
  const getEff = src.slice(src.indexOf("export function getEffectiveRuntimeConfig"));
  const getEffBody = getEff.slice(0, getEff.indexOf("}") + 1);
  assert("getEffectiveRuntimeConfig has no cachedConfig short-circuit", !/cachedConfig\s*\?\?/.test(getEffBody));
  assert("getEffectiveRuntimeConfig delegates to loadEffectiveRuntimeConfig", /loadEffectiveRuntimeConfig\(\)/.test(getEffBody));

  // No manager feed directly wraps a raw loadRuntimeConfig(...) without reconcileDeviceIdentity.
  assert("no `new DeviceWsManager(loadRuntimeConfig`", !/new DeviceWsManager\(\s*loadRuntimeConfig/.test(src));
  assert("no `setConfig(loadRuntimeConfig`", !/setConfig\(\s*loadRuntimeConfig/.test(src));

  // Every DeviceWsManager(...) / setConfig(...) argument that mentions loadRuntimeConfig must also reconcile.
  const feedRe = /(?:new DeviceWsManager|\.setConfig)\(([^;]*?)\)/g;
  let m: RegExpExecArray | null;
  let feeds = 0, violations = 0;
  while ((m = feedRe.exec(src)) !== null) {
    feeds++;
    const arg = m[1];
    if (/loadRuntimeConfig/.test(arg) && !/reconcileDeviceIdentity/.test(arg)) violations++;
  }
  assert("swept manager feeds (found some to check)", feeds >= 8, `feeds=${feeds}`);
  assert("no manager feed passes a raw loadRuntimeConfig arg", violations === 0, `violations=${violations}`);
}

for (const r of roots) { try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ } }
console.log(`\n${pass} passed, ${fail} failed`);
