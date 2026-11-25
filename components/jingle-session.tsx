"use client";

/**
 * Jingle Access Token acquisition (F3).
 *
 * Any authenticated device that can FIRE a jingle needs a workspace-scoped token to append to the
 * audio URL before it reaches the station MPV (the MASTER desktop fires its own; a CONTROL / Control
 * Room sends PLAY_INTERRUPT with the URL the MASTER's MPV then fetches). So — unlike the MASTER-only
 * media token — this is acquired on ANY logged-in device, not gated to deviceMode.
 *
 * Refresh is atomic + background-safe: the current token stays live during a refresh and is replaced
 * ONLY on a successful re-authorize; on failure the old token is kept and retried. The threshold
 * (≫ any jingle clip) guarantees a fire never outlives the token — with no I/O on the fire path.
 * Renders null. Touches no playback / WS / orchestrator code.
 */

import { useEffect, useRef } from "react";
import { setJingleToken, jingleTokenRemainingSec } from "@/lib/jingles/jingle-session";

const REFRESH_THRESHOLD_SEC = 10 * 60; // refresh well before the 30 min default expiry
const POLL_MS = 30 * 1000;

export function JingleSession(): null {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const authorize = async (): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/jingles/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const raw = await res.text();
        let j: { ok?: boolean; token?: string; exp?: number } = {};
        if (raw) { try { j = JSON.parse(raw); } catch { /* keep old token */ } }
        if (!cancelled && res.ok && j.ok && j.token && j.exp) {
          setJingleToken(j.token, j.exp); // atomic replace — old token stayed live until here
        }
        // On failure (e.g. not signed in yet): keep any existing token; the interval retries.
      } catch {
        /* keep existing token; retry next tick */
      } finally {
        inFlight.current = false;
      }
    };

    void authorize();
    timer.current = setInterval(() => {
      if (jingleTokenRemainingSec() < REFRESH_THRESHOLD_SEC) void authorize();
    }, POLL_MS);

    return () => {
      cancelled = true;
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    };
  }, []);

  return null;
}
