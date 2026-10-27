"use client";

/**
 * The device's own side of enrollment (docs/DEVICE_ENROLLMENT_DESIGN.md §5.1–5.2): ask the server "what am I?" for this browser profile's enrollment id, and request a role.
 * `state === null` while unknown / not applicable (nothing is shown). Dormant by itself: the server answers `enforced:false` unless enrollment is on for the workspace, and the desktop app's own
 * screen never asks (stations use the activation code). Polling is calm: 20 s while a request is pending (then 60 s), a 5-minute re-check while approved (so a revoke shows up), nothing otherwise.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getEnrollmentDeviceId } from "@/lib/enrollment-device-id";

export type EnrollmentClientStatus =
  | { enforced: false; status: "disabled" }
  | { enforced: true; status: "unknown" }
  | { enforced: true; status: "pending" | "rejected" | "revoked" | "expired"; requestedAt: string; expiresAt: string; decisionNote?: string }
  | { enforced: true; status: "approved"; role: "PLAYER" | "REMOTE"; playerClass: "station" | "browser" | null; branchIds: string[] };

export type EnrollmentRequest = { role: "PLAYER" | "REMOTE"; branchId: string | null; label: string; note: string; platform: "browser" | "ios" | "android" };

function isDesktopShell(): boolean {
  return typeof window !== "undefined" && Boolean((window as Window & { syncbizDesktop?: unknown }).syncbizDesktop);
}

export function detectPlatform(): "browser" | "ios" | "android" {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "browser";
}

/** a short, human name for this device ("Chrome on Windows") — the manager sees it in the request */
export function detectDeviceLabel(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function useEnrollmentGate(): { state: EnrollmentClientStatus | null; request: (r: EnrollmentRequest) => Promise<{ ok: boolean; error?: string }>; refresh: () => void } {
  const [state, setState] = useState<EnrollmentClientStatus | null>(null);
  const idRef = useRef<string | null>(null);
  const polls = useRef(0);

  const check = useCallback(async () => {
    if (isDesktopShell()) return;
    const id = idRef.current ?? getEnrollmentDeviceId();
    idRef.current = id;
    if (!id) return;
    try {
      const r = await fetch("/api/devices/enrollment/status", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ durableDeviceId: id }) });
      if (!r.ok) return;
      setState((await r.json()) as EnrollmentClientStatus);
    } catch {
      /* offline — keep what we know */
    }
  }, []);

  useEffect(() => {
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  const status = state && state.enforced ? state.status : null;
  useEffect(() => {
    if (status !== "pending" && status !== "approved") {
      polls.current = 0;
      return;
    }
    const delay = status === "approved" ? 300_000 : polls.current < 10 ? 20_000 : 60_000;
    const t = window.setTimeout(() => {
      polls.current += 1;
      void check();
    }, delay);
    return () => window.clearTimeout(t);
  }, [status, state, check]);

  const request = useCallback(
    async (r: EnrollmentRequest) => {
      const id = idRef.current ?? getEnrollmentDeviceId();
      if (!id) return { ok: false, error: "no_storage" };
      try {
        const res = await fetch("/api/devices/enrollment/request", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ durableDeviceId: id, role: r.role, platform: r.platform, branchId: r.branchId, label: r.label, note: r.note }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: j.error ?? "other" };
        }
        setState((await res.json()) as EnrollmentClientStatus);
        polls.current = 0;
        return { ok: true };
      } catch {
        return { ok: false, error: "other" };
      }
    },
    [],
  );

  return { state, request, refresh: () => void check() };
}
