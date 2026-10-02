"use client";

import { useEffect } from "react";
import { runActivationWithRetry, type ActivationDeps, type TokenResult } from "@/lib/desktop-activation-core";

/**
 * Desktop activation (Electron only). After ONE normal hosted login, this gives the Electron MAIN process a
 * bound desktop_access token automatically — no second sign-in, no legacy renderer, no manual config:
 *   1. gated on the Desktop bridge being present (plain browsers no-op → unchanged behavior);
 *   2. confirms an authenticated session (/api/auth/me);
 *   3. reads the durable deviceId from the bridge;
 *   4. POSTs SAME-ORIGIN to /api/auth/desktop/token-from-session (server ensures StationDevice FIRST, then mints
 *      a token already carrying stationDeviceId + designatedMasterByBranch; fails CLOSED with 409 if it cannot bind);
 *   5. hands ONLY the token + expiry to MAIN via applyDesktopAuth (MAIN stores it and reconnects/registers).
 *
 * Reliability: activation is marked complete ONLY after applyDesktopAuth returns { ok:true }. Transient failures
 * (not-signed-in-yet, no deviceId, network/5xx, missing token, applyDesktopAuth { ok:false }) retry automatically
 * with a small capped backoff and keep retrying for the LIFETIME of the running app — an unattended branch player
 * recovers from an outage of any length with no human reload/sign-out/restart. A binding conflict (409) is terminal
 * and fail closed (an unbound token is never applied). Never logs the token.
 */
let activationDone = false; // set ONLY after a confirmed successful activation
let activationInFlight = false; // prevents concurrent retry loops across remounts

// Bounded backoff: delay grows to the cap and then holds there; the loop itself never gives up (persists for
// the app's lifetime) so a prolonged internet/API outage self-heals once connectivity returns.
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function makeRendererDeps(bridge: NonNullable<Window["syncbizDesktop"]>): ActivationDeps {
  return {
    checkSession: async () => {
      const me = await fetch("/api/auth/me", { credentials: "include" });
      return me.ok;
    },
    getDeviceId: async () => {
      const cfg = await bridge.getConfig();
      return cfg?.deviceId ?? null;
    },
    getBranchId: async () => {
      const cfg = await bridge.getConfig();
      return cfg?.branchId ?? "default";
    },
    requestToken: async ({ deviceId, branchId }): Promise<TokenResult> => {
      const res = await fetch("/api/auth/desktop/token-from-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, branchId, platform: "desktop" }),
      });
      if (res.status === 409) return { status: "conflict" }; // server could not bind — terminal, fail closed
      if (!res.ok) return { status: "transient" };
      let data: { token?: string; expiresAt?: string; bound?: boolean } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        return { status: "transient" };
      }
      if (!data.token || data.bound === false) return { status: "transient" };
      return { status: "ok", token: data.token, expiresAtIso: data.expiresAt };
    },
    applyAuth: async ({ token, expiresAtIso }) => {
      const r = await bridge.applyDesktopAuth!({ token, expiresAtIso });
      return Boolean(r?.ok);
    },
  };
}

export function useDesktopActivation(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const bridge = window.syncbizDesktop;
    // Not running inside the Electron desktop (or an older shell without the auth bridge) → do nothing.
    if (!bridge || typeof bridge.applyDesktopAuth !== "function" || typeof bridge.getConfig !== "function") return;
    if (activationDone || activationInFlight) return;
    activationInFlight = true;

    let cancelled = false;
    void runActivationWithRetry(makeRendererDeps(bridge), {
      baseDelayMs: BASE_DELAY_MS,
      maxDelayMs: MAX_DELAY_MS,
      sleep,
      isCancelled: () => cancelled,
    })
      .then((r) => {
        // Mark complete ONLY on confirmed success. conflict/cancelled leave the flag clear so a later
        // mount (after the owner fixes a designation) can resume.
        if (r.kind === "success") activationDone = true;
      })
      .catch(() => {
        /* never throw into render; do not log token/credentials */
      })
      .finally(() => {
        activationInFlight = false;
      });

    return () => {
      cancelled = true;
    };
  }, []);
}
