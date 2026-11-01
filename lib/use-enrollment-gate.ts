"use client";

/**
 * The device's own side of enrollment (docs/DEVICE_ENROLLMENT_DESIGN.md §5.1–5.2): ask the server "what am I?" for this browser profile's enrollment id, and request a role.
 * `state === null` while the answer is not known yet (the hold screen shows a calm "connecting" until it is). The server answers `enforced:false` unless enrollment is on for the workspace.
 * The desktop app's own screen never asks (stations use the activation code, and the layout does not hold it). Polling is calm: 20 s while a request is pending (then 60 s), a 20-second
 * re-check while approved (so a revoke shows up within seconds — it was 5 minutes until 2026-11-01), plus an immediate check when the tab is focused / visible or the network returns, a 4-second retry while the very first answer has not arrived, nothing otherwise.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { detectDeviceLabel, getEnrollmentDeviceId } from "@/lib/enrollment-device-id";

export { detectDeviceLabel };

export type EnrollmentClientStatus =
  | { enforced: false; status: "disabled" }
  | { enforced: true; status: "unknown"; ownerAllowed?: boolean }
  | { enforced: true; status: "pending" | "rejected" | "revoked" | "expired"; requestedAt: string; expiresAt: string; decisionNote?: string; ownerAllowed?: boolean }
  | { enforced: true; status: "approved"; role: "PLAYER" | "REMOTE"; playerClass: "station" | "browser" | null; branchIds: string[] };

export type EnrollmentRequest = {
  role: "PLAYER" | "REMOTE";
  /** an existing branch picked from the suggestions (a Remote must have one) */
  branchId: string | null;
  /** a branch name typed that matched nothing (a Player only) */
  branchName: string;
  /** with a typed (new) branch: where it is and its brand */
  branchAddress: string;
  brandName: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  label: string;
  note: string;
  platform: "browser" | "ios" | "android";
};

export type EnrollmentGateApi = {
  state: EnrollmentClientStatus | null;
  /** this browser cannot keep an id (private window / storage blocked): it can never be approved */
  noStorage: boolean;
  request: (r: EnrollmentRequest) => Promise<{ ok: boolean; error?: string }>;
  /** "I'm the owner": the main admin approves this device himself (the server refuses anyone else) */
  becomeOwner: (platform: "browser" | "ios" | "android", label: string) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => void;
};

/** The last "approved" answer is remembered for a few minutes so an approved device does not wait a network round trip on every page load (the app starts at once while the check runs in the background;
 *  a revoke still takes the app away as soon as the answer arrives). Storage failures are ignored. */
export const OK_KEY = "vono_enr_ok";
const OK_MS = 10 * 60_000;
/** how often an APPROVED device asks the server "am I still approved?" (a revoke takes the app away within this time; the desktop app never asks) */
export const APPROVED_RECHECK_MS = 20_000;
function readOk(id: string): EnrollmentClientStatus | null {
  try {
    const j = JSON.parse(window.localStorage.getItem(OK_KEY) ?? "null") as { id?: string; at?: number; status?: EnrollmentClientStatus } | null;
    if (j && j.id === id && typeof j.at === "number" && Date.now() - j.at < OK_MS && j.status && j.status.enforced && j.status.status === "approved") return j.status;
  } catch {
    /* ignore */
  }
  return null;
}
function writeOk(id: string, s: EnrollmentClientStatus): void {
  try {
    if (s.enforced && s.status === "approved") window.localStorage.setItem(OK_KEY, JSON.stringify({ id, at: Date.now(), status: s }));
    else window.localStorage.removeItem(OK_KEY);
  } catch {
    /* ignore */
  }
}

function isDesktopShell(): boolean {
  return typeof window !== "undefined" && Boolean((window as Window & { syncbizDesktop?: unknown }).syncbizDesktop);
}

export function detectPlatform(): "browser" | "ios" | "android" {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "browser";
}

export function useEnrollmentGate(): EnrollmentGateApi {
  const [state, setState] = useState<EnrollmentClientStatus | null>(null);
  const [noStorage, setNoStorage] = useState(false);
  const [failures, setFailures] = useState(0);
  const idRef = useRef<string | null>(null);
  const polls = useRef(0);

  const check = useCallback(async () => {
    if (isDesktopShell()) return;
    const id = idRef.current ?? getEnrollmentDeviceId();
    idRef.current = id;
    if (!id) {
      setNoStorage(true);
      return;
    }
    try {
      const r = await fetch("/api/devices/enrollment/status", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ durableDeviceId: id }) });
      if (!r.ok) {
        setFailures((n) => n + 1);
        return;
      }
      const next = (await r.json()) as EnrollmentClientStatus;
      writeOk(id, next);
      setState(next);
    } catch {
      /* offline — keep what we know; while nothing is known yet the retry below asks again */
      setFailures((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    // an approved answer from the last few minutes lets the app start at once; the check below confirms (or takes it away)
    const id = getEnrollmentDeviceId();
    const cached = id ? readOk(id) : null;
    if (cached) setState((cur) => cur ?? cached);
    void check();
    const onFocus = () => void check();
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus); // network back: ask at once (a revoke may have happened meanwhile)
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  // the very first answer has not arrived (server busy / offline for a moment): ask again every 4 seconds
  useEffect(() => {
    if (state !== null || noStorage || failures === 0) return;
    const t = window.setTimeout(() => void check(), 4_000);
    return () => window.clearTimeout(t);
  }, [state, noStorage, failures, check]);

  const status = state && state.enforced ? state.status : null;
  useEffect(() => {
    if (status !== "pending" && status !== "approved") {
      polls.current = 0;
      return;
    }
    // owner 2026-11-01: a device a manager just revoked kept working until its next refresh — the 5-minute re-check was too slow; an approved device now asks every 20 s
    const delay = status === "approved" ? APPROVED_RECHECK_MS : polls.current < 10 ? 20_000 : 60_000;
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
          body: JSON.stringify({
            durableDeviceId: id,
            role: r.role,
            platform: r.platform,
            branchId: r.branchId,
            branchName: r.branchName,
            branchAddress: r.branchAddress,
            brandName: r.brandName,
            firstName: r.firstName,
            lastName: r.lastName,
            phone: r.phone,
            email: r.email,
            label: r.label,
            note: r.note,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: j.error ?? "other" };
        }
        const next = (await res.json()) as EnrollmentClientStatus;
        writeOk(id, next);
        setState(next);
        polls.current = 0;
        return { ok: true };
      } catch {
        return { ok: false, error: "other" };
      }
    },
    [],
  );

  const becomeOwner = useCallback(
    async (platform: "browser" | "ios" | "android", label: string) => {
      const id = idRef.current ?? getEnrollmentDeviceId();
      if (!id) return { ok: false, error: "no_storage" };
      try {
        const res = await fetch("/api/devices/enrollment/owner", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ durableDeviceId: id, platform, label }) });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: j.error ?? "other" };
        }
        const next = (await res.json()) as EnrollmentClientStatus;
        writeOk(id, next);
        setState(next);
        return { ok: true };
      } catch {
        return { ok: false, error: "other" };
      }
    },
    [],
  );

  return { state, noStorage, request, becomeOwner, refresh: () => void check() };
}
