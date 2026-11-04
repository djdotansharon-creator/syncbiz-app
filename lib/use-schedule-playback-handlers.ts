"use client";

import { useMemo } from "react";
import type { SchedulePlaybackHandlers } from "@/lib/schedule-playback-client";
import { usePlayback } from "@/lib/playback-provider";
import { useRoutedPlaySource } from "@/lib/use-routed-play-source";
import { useDevicePlayer } from "@/lib/device-player-context";
import { decideScheduleRoute } from "@/lib/schedule-station-route";

/** Inside the desktop shell with MAIN's status bridge (the same bridge device-player-context resolves the designation from). */
function hasDesktopStatusBridge(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as unknown as { syncbizDesktop?: { onStatus?: unknown } }).syncbizDesktop;
  return typeof bridge?.onStatus === "function";
}

/**
 * Schedule "Play now" / auto-play must use the same routing as the rest of the app:
 * local `playSource` when standalone or MASTER; `PLAY_SOURCE` to the station when this tab is CONTROL.
 * On the designated station's own window (2026-11-04, lib/schedule-station-route.ts) it is EXACTLY a manual click:
 * `playSourceOrSend`, whatever the cloud WS state — and `route` tells runSchedulePlayback when it must wait.
 */
export function useSchedulePlaybackHandlers(): SchedulePlaybackHandlers {
  const { stop, setQueue, setLastMessage } = usePlayback();
  const routedPlaySource = useRoutedPlaySource();
  const device = useDevicePlayer();

  const isDesktopShell = !!device && hasDesktopStatusBridge();
  const mainSnapResolved = device?.mainSnapResolved ?? false;
  const isDesignatedStation = device?.isDesignatedAudioStation ?? false;
  const isBranchConnected = device?.isBranchConnected ?? false;
  const hasMaster = !!device?.masterDeviceId;
  const stationPlay = device?.playSourceOrSend;

  return useMemo(() => {
    const route = decideScheduleRoute({ isDesktopShell, mainSnapResolved, isDesignatedStation, isBranchConnected, hasMaster });
    const playSource = route.kind === "station" && stationPlay ? stationPlay : routedPlaySource;
    return { stop, setQueue, playSource, setLastMessage, route };
  }, [stop, setQueue, setLastMessage, routedPlaySource, stationPlay, isDesktopShell, mainSnapResolved, isDesignatedStation, isBranchConnected, hasMaster]);
}
