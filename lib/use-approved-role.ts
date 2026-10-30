"use client";

/**
 * The role this device was approved for (PLAYER / REMOTE), read from the answer the enrollment gate already remembers in this browser (lib/use-enrollment-gate.ts) — no request of its own. null = not known / not
 * approved / device approval is off for this business. The gate refreshes the answer at least every 5 minutes; anything older than 15 minutes is ignored.
 */

import { useSyncExternalStore } from "react";
import { OK_KEY } from "@/lib/use-enrollment-gate";

const FRESH_MS = 15 * 60_000;

export function readApprovedRole(): "PLAYER" | "REMOTE" | null {
  try {
    const j = JSON.parse(window.localStorage.getItem(OK_KEY) ?? "null") as { at?: number; status?: { enforced?: boolean; status?: string; role?: string } } | null;
    if (j && typeof j.at === "number" && Date.now() - j.at < FRESH_MS && j.status?.enforced && j.status.status === "approved") {
      return j.status.role === "PLAYER" || j.status.role === "REMOTE" ? j.status.role : null;
    }
  } catch {
    /* storage blocked */
  }
  return null;
}

export function useApprovedRole(): "PLAYER" | "REMOTE" | null {
  return useSyncExternalStore(() => () => {}, readApprovedRole, () => null);
}
