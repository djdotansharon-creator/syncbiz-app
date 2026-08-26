"use client";

/**
 * MASTER-side Media Session ownership (Stage A.1).
 *
 * When THIS device is the MASTER, it acquires its OWN Media Session Token (POST
 * /api/music-bank/authorize) and refreshes it in the background — so a routed Music Bank source
 * (sent TOKEN-FREE by a CONTROL over WS) plays: getPlayUrl finds the MASTER's token in memory and
 * appends it synchronously. CONTROL devices never hold or send a media token; the token never
 * travels over WS.
 *
 * Refresh is atomic + background-safe: the current token stays live during a refresh and is replaced
 * ONLY on a successful re-authorize; on failure the old token is kept and retried. The refresh
 * threshold (> max preview track + margin) guarantees a starting track never outlives the token —
 * with no I/O in getPlayUrl. Renders null. No WS/orchestrator/MpvManager/getPlayUrl changes.
 */

import { useEffect, useRef } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { setMediaSessionToken, mediaTokenRemainingSec } from "@/lib/media/media-session";

const REFRESH_THRESHOLD_SEC = 8 * 60; // ≈ maxPreviewTrack(~6m) + margin — refresh well before expiry
const POLL_MS = 30 * 1000;

export function MasterMediaSession(): null {
  const dp = useDevicePlayer();
  const isMaster = dp?.deviceMode === "MASTER";
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isMaster) return; // CONTROL / unknown: no media token needed — routing sends to the MASTER.
    let cancelled = false;

    const authorize = async (): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/music-bank/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: "master" }),
        });
        const raw = await res.text();
        let j: { ok?: boolean; token?: string; exp?: number } = {};
        if (raw) { try { j = JSON.parse(raw); } catch { /* keep old token */ } }
        if (!cancelled && res.ok && j.ok && j.token && j.exp) {
          setMediaSessionToken(j.token, j.exp); // atomic replace — old token stayed live until here
        }
        // On failure: keep the existing token; the interval retries.
      } catch {
        /* keep existing token; retry next tick */
      } finally {
        inFlight.current = false;
      }
    };

    // Acquire on becoming MASTER — token ready before any Music Bank playback request arrives.
    void authorize();
    timer.current = setInterval(() => {
      if (mediaTokenRemainingSec() < REFRESH_THRESHOLD_SEC) void authorize();
    }, POLL_MS);

    return () => {
      cancelled = true;
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    };
  }, [isMaster]);

  return null;
}
