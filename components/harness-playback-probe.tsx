"use client";

import { useEffect } from "react";
import { usePlaybackOptional } from "@/lib/playback-provider";
import { useDevicePlayer } from "@/lib/device-player-context";

/**
 * READ-ONLY playback diagnostic probe for the P1.1 regression harness.
 *
 * Maintains a PERSISTENT read-only snapshot at `window.__sbState` (a plain object), refreshed
 * on every render from public context (`usePlaybackOptional`, `useDevicePlayer`). It is
 * deliberately NOT deleted on unmount, so a transient dev remount (RSC refresh / WS reconnect)
 * never makes the snapshot momentarily disappear — the object simply keeps its last value until
 * the next render repopulates it. Read-only: zero writes to app state, zero behavior change.
 * SAFETY: active ONLY when the build sets NEXT_PUBLIC_SB_HARNESS === "1" (explicit opt-in for
 * local dev/harness builds). Real production deploys never set it, so the probe + its global are
 * entirely absent there. The flag is inlined at build time.
 *
 * Live playback POSITION is not read here (it lives in the DOM timeline slider `aria-valuenow`);
 * the harness reads it from the slider.
 */
export function HarnessPlaybackProbe() {
  const pb = usePlaybackOptional();
  const dev = useDevicePlayer();

  // Refresh the persistent global every render (no deps). No cleanup → survives remounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SB_HARNESS !== "1") return;
    if (typeof window === "undefined") return;
    const q = pb?.queue ?? [];
    const qi = typeof pb?.queueIndex === "number" ? pb.queueIndex : -1;
    (window as unknown as { __sbState?: unknown }).__sbState = {
      t: Date.now(),
      deviceMode: dev?.deviceMode ?? null,
      deviceId: dev?.deviceId ?? null,
      wsStatus: dev?.status ?? null,
      isBranchConnected: dev?.isBranchConnected ?? false,
      masterDeviceId: dev?.masterDeviceId ?? null,
      status: pb?.status ?? null,
      currentSourceId: pb?.currentSource?.id ?? null,
      currentTitle: pb?.currentSource?.title ?? pb?.currentTrack?.title ?? null,
      currentType: pb?.currentSource?.type ?? null,
      currentTrackIndex: typeof pb?.currentTrackIndex === "number" ? pb.currentTrackIndex : null,
      // Number of tracks inside the current playlist source (multi-track playlists advance via
      // currentTrackIndex, not queueIndex — the automix/end-of-track signal).
      playlistTrackCount: pb?.currentPlaylist?.tracks?.length ?? null,
      currentPlayUrl: pb?.currentPlayUrl ?? null,
      isEmbedded: pb?.isEmbedded ?? false,
      playCommandEpoch: typeof pb?.playCommandEpoch === "number" ? pb.playCommandEpoch : null,
      queueLen: q.length,
      queueIndex: qi,
      queueCurrentId: qi >= 0 && qi < q.length ? (q[qi]?.id ?? null) : (pb?.currentSource?.id ?? null),
      queueNextId: qi >= 0 && qi + 1 < q.length ? (q[qi + 1]?.id ?? null) : null,
    };
  });

  return null;
}
