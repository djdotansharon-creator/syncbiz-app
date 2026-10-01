"use client";

import { useEffect } from "react";

/**
 * Desktop activation (Electron only). After ONE normal hosted login, this gives the Electron MAIN process a
 * bound desktop_access token automatically — no second sign-in, no legacy renderer, no manual config:
 *   1. gated on the Desktop bridge being present (plain browsers no-op → unchanged behavior);
 *   2. confirms an authenticated session (/api/auth/me);
 *   3. reads the durable deviceId from the bridge;
 *   4. POSTs SAME-ORIGIN to /api/auth/desktop/token-from-session (server ensures StationDevice FIRST, then mints
 *      a token already carrying stationDeviceId + designatedMasterByBranch);
 *   5. hands ONLY the token + expiry to MAIN via applyDesktopAuth (MAIN stores it and reconnects/registers).
 * Runs once per app session. Never logs the token.
 */
let activationAttempted = false;

export function useDesktopActivation(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const bridge = window.syncbizDesktop;
    // Not running inside the Electron desktop (or an older shell without the auth bridge) → do nothing.
    if (!bridge || typeof bridge.applyDesktopAuth !== "function" || typeof bridge.getConfig !== "function") return;
    if (activationAttempted) return;
    activationAttempted = true;

    let cancelled = false;
    (async () => {
      try {
        const me = await fetch("/api/auth/me", { credentials: "include" });
        if (cancelled || !me.ok) return; // not signed in yet — a later mount after login retries (flag reset on reload)
        const cfg = await bridge.getConfig();
        const deviceId = cfg?.deviceId;
        if (!deviceId) return;
        const res = await fetch("/api/auth/desktop/token-from-session", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId,
            branchId: cfg?.branchId ?? "default",
            platform: "desktop",
          }),
        });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { token?: string; expiresAt?: string };
        if (cancelled || !data?.token) return;
        await bridge.applyDesktopAuth!({ token: data.token, expiresAtIso: data.expiresAt });
      } catch {
        // Never throw into render; a reload will retry. Do not log token/credentials.
        activationAttempted = false;
      }
    })();
    return () => { cancelled = true; };
  }, []);
}
