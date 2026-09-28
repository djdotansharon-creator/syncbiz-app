/**
 * Phase 0.1 — runtime enforcement that ProgramData is the IMMUTABLE device-identity authority.
 *
 * Pure (no Electron): all MAIN config-mutation paths that feed DeviceWsManager route through here so
 * config.deviceId can never drift from C:\ProgramData\VONO\state\device-id.json — not via SAVE_CONFIG, not via
 * a manual/raw config edit, not via sign-in. deviceId is NOT settable at runtime; only ProgramData decides it.
 */
import { resolveDurableDeviceId } from "./durable-device-id";
import { saveRuntimeConfig } from "./runtime-config-service";
import type { DesktopRuntimeConfig } from "../shared/mvp-types";

/**
 * Force `cfg.deviceId` to the durable ProgramData id. If they already match, returns `cfg` unchanged; otherwise
 * returns a copy with the durable id and PERSISTS the correction to runtime config (so raw reads self-heal).
 * Never generates over a valid id; migrates an existing config id into ProgramData only when ProgramData is empty.
 */
export function reconcileDeviceIdentity(userData: string, cfg: DesktopRuntimeConfig): DesktopRuntimeConfig {
  const durable = resolveDurableDeviceId(cfg.deviceId);
  if (durable.id === cfg.deviceId) return cfg;
  const next: DesktopRuntimeConfig = { ...cfg, deviceId: durable.id };
  saveRuntimeConfig(userData, next);
  return next;
}

/**
 * Remove `deviceId` from a runtime-config patch — deviceId is not settable at runtime. Returns a new object
 * without the key; callers still reconcile the result so the durable id is re-asserted.
 */
export function stripDeviceIdFromPatch<T extends { deviceId?: unknown }>(patch: T | null | undefined): Omit<T, "deviceId"> {
  const { deviceId: _ignoredDeviceId, ...rest } = patch ?? ({} as T);
  return rest;
}
