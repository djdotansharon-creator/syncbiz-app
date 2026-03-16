"use client";

import { useEffect, useRef } from "react";
import { usePlayback } from "@/lib/playback-provider";
import { useRemoteControlWs } from "@/lib/remote-control/ws-client";
import { playbackToStationState } from "@/lib/remote-control/playback-to-state";

/** Publishes playback state to the station server when this device is the active player. */
export function StationPlayerSync({ deviceId }: { deviceId: string }) {
  const { status, sendState } = useRemoteControlWs("device", deviceId, undefined);
  const {
    status: playStatus,
    currentSource,
    currentTrackIndex,
    queue,
    queueIndex,
  } = usePlayback();
  const lastSentRef = useRef<string>("");

  useEffect(() => {
    if (status !== "connected" || !sendState) return;

    const state = playbackToStationState(
      playStatus,
      currentSource,
      currentTrackIndex,
      queue,
      queueIndex
    );
    const key = JSON.stringify(state);
    if (key === lastSentRef.current) return;
    lastSentRef.current = key;
    sendState(state);
  }, [status, sendState, playStatus, currentSource?.id, currentTrackIndex, queue, queueIndex]);

  return null;
}
