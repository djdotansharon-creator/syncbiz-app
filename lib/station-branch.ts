"use client";

import { useEffect, useState } from "react";

/**
 * STATION BRANCH IDENTITY (Step B1, owner 2026-10-11) — the ONE place the renderer learns which branch THIS screen
 * belongs to, so every live channel of the screen (the device socket → playback, remote commands, jingles On-Air /
 * PLAY_INTERRUPT, the controller socket) joins the SAME branch room as this computer's MAIN.
 *
 *  - Packaged desktop: MAIN's runtime config branchId (set by station activation). A station that was never activated
 *    — the existing Lenovo included — has "default" (or nothing) → "default", EXACTLY as before.
 *  - Browser / phone / streamer page: always "default" (unchanged).
 *  - Bridge error or no answer within 3 s → "default" (= today's behaviour; never blocks the socket forever).
 */
export const LEGACY_STATION_BRANCH = "default";
const BRIDGE_TIMEOUT_MS = 3000;

let resolved: string | null = null;
let pending: Promise<string> | null = null;

function hasDesktopBridge(): boolean {
  return typeof window !== "undefined" && typeof window.syncbizDesktop?.getConfig === "function";
}

/** Synchronous value when known: "default" off-desktop; null while the desktop bridge has not answered yet. */
export function stationBranchIdNow(): string | null {
  if (!hasDesktopBridge()) return LEGACY_STATION_BRANCH;
  return resolved;
}

export function resolveStationBranchId(): Promise<string> {
  if (!hasDesktopBridge()) return Promise.resolve(LEGACY_STATION_BRANCH);
  if (resolved) return Promise.resolve(resolved);
  if (!pending) {
    const fromBridge = window
      .syncbizDesktop!.getConfig()
      .then((cfg) => (typeof cfg?.branchId === "string" && cfg.branchId.trim() ? cfg.branchId.trim() : LEGACY_STATION_BRANCH))
      .catch(() => LEGACY_STATION_BRANCH);
    const timeout = new Promise<string>((r) => setTimeout(() => r(LEGACY_STATION_BRANCH), BRIDGE_TIMEOUT_MS));
    pending = Promise.race([fromBridge, timeout]).then((b) => {
      resolved = b;
      return b;
    });
  }
  return pending;
}

/** React: the station branch id, or null until the desktop bridge answered (sockets wait for it). */
export function useStationBranchId(): string | null {
  const [branchId, setBranchId] = useState<string | null>(() => stationBranchIdNow());
  useEffect(() => {
    if (branchId !== null) return;
    let cancelled = false;
    void resolveStationBranchId().then((b) => { if (!cancelled) setBranchId(b); });
    return () => { cancelled = true; };
  }, [branchId]);
  return branchId;
}
