/**
 * Desktop engine version helpers (owner 2026-11-02): the player's header pill and the "Player details" window compare the
 * running desktop app's version with the newest one published on the site. Pure — no I/O.
 */

/**
 * Last desktop version shipped WITHOUT the `getAppVersion` bridge. Any client missing the bridge is <= this version, so a
 * server build newer than this is unambiguously an update for them.
 */
export const LAST_LEGACY_VERSION = "0.1.2";

/**
 * The oldest desktop engine this web app still works with. Raise it ONLY when a web / server change needs a newer engine:
 * every player older than this then shows a red "Update required" pill instead of the amber "Update". "0.0.0" = off.
 */
export const MIN_ENGINE_VERSION = "0.0.0";

/** [major, minor, patch] from "X.Y.Z(-tag)"; null when it is not a version. */
export function parseSemver(v: string): [number, number, number] | null {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when `latest` is strictly newer than `current` (pre-release tags are ignored, as before). */
export function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/** True when this engine is older than the minimum the web app needs (a legacy bridge-less client is always older). */
export function isBelowMinEngine(current: string | null, min: string = MIN_ENGINE_VERSION): boolean {
  if (!parseSemver(min) || min === "0.0.0") return false;
  return current === null ? isNewer(min, LAST_LEGACY_VERSION) : isNewer(min, current);
}
