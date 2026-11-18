"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { SchedulePlaybackHandlers } from "@/lib/schedule-playback-client";
import { usePlayback } from "@/lib/playback-provider";
import { useRoutedPlaySource } from "@/lib/use-routed-play-source";
import { useDevicePlayer } from "@/lib/device-player-context";
import { decideScheduleRoute } from "@/lib/schedule-station-route";
import { hasMediaSessionToken, subscribeMediaSession } from "@/lib/media/media-session";
import type { PlayStatus } from "@/lib/schedule-start-retry";

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
  const { stop, setQueue, setLastMessage, status: providerStatus, volume: providerVolume, setVolume: providerSetVolume } = usePlayback();
  const routedPlaySource = useRoutedPlaySource();
  const device = useDevicePlayer();
  // is music playing right now: the station's own status (what MAIN really plays) or this window's — read at call time, so the handlers keep their identity while the status changes
  const audibleRef = useRef(false);
  const masterStatus = device?.masterState?.status;
  useEffect(() => {
    audibleRef.current = providerStatus === "playing" || masterStatus === "playing";
  });
  const isAudible = useCallback(() => audibleRef.current, []);
  // the volume a block's own setting changes (and the one it found): the station's (what MAIN really plays) else this window's
  const volumeRef = useRef<number | null>(null);
  const masterVolume = device?.masterState?.volume;
  useEffect(() => {
    volumeRef.current = typeof masterVolume === "number" ? masterVolume : typeof providerVolume === "number" ? providerVolume : null;
  });
  const getVolume = useCallback(() => volumeRef.current, []);
  const setVolumeOrSend = device?.setVolumeOrSend;
  const setVolume = setVolumeOrSend ?? providerSetVolume;

  const isDesktopShell = !!device && hasDesktopStatusBridge();
  const mainSnapResolved = device?.mainSnapResolved ?? false;
  const isDesignatedStation = device?.isDesignatedAudioStation ?? false;
  const isBranchConnected = device?.isBranchConnected ?? false;
  const hasMaster = !!device?.masterDeviceId;
  // what the Player is doing, for the engine's check that a block's start really started the music: the station's own status (MAIN) when this window shows / controls a station — null until the first
  // status has arrived, so "not known yet" is never taken for "silent" — else this window's own player
  const playStatusRef = useRef<PlayStatus>(null);
  const controlsAnother = (device?.deviceMode === "CONTROL" && hasMaster) || isDesignatedStation;
  useEffect(() => {
    playStatusRef.current = controlsAnother ? (masterStatus ?? null) : (providerStatus ?? null);
  });
  const getPlayStatus = useCallback(() => playStatusRef.current, []);
  // a window that only controls ANOTHER player (not the station's own window): it never takes over music that plays when it opens in the middle of a block
  const controlsRef = useRef(false);
  useEffect(() => {
    controlsRef.current = device?.deviceMode === "CONTROL" && hasMaster && !isDesignatedStation;
  });
  const controlsAnotherPlayer = useCallback(() => controlsRef.current, []);
  const stationPlay = device?.playSourceOrSend;
  const stopOrSend = device?.stopOrSend;
  // a music bank streams through the media token the MASTER holds; a CONTROL only routes the token-free source to it (same rule as the Royalty-Free screen)
  const hasToken = useSyncExternalStore(subscribeMediaSession, hasMediaSessionToken, () => false);
  const bankStreamReady = device?.deviceMode === "CONTROL" ? true : hasToken;

  return useMemo(() => {
    const route = decideScheduleRoute({ isDesktopShell, mainSnapResolved, isDesignatedStation, isBranchConnected, hasMaster });
    const playSource = route.kind === "station" && stationPlay ? stationPlay : routedPlaySource;
    // a scheduled END / quiet block stops the music exactly like the Stop button does (on a station or a controller that is MAIN's STOP command)
    const stopScheduled = stopOrSend ?? stop;
    return { stop, setQueue, playSource, setLastMessage, route, stopScheduled, isAudible, getPlayStatus, controlsAnotherPlayer, getVolume, setVolume, bankStreamReady };
  }, [stop, setQueue, setLastMessage, routedPlaySource, stationPlay, stopOrSend, isAudible, getPlayStatus, controlsAnotherPlayer, getVolume, setVolume, isDesktopShell, mainSnapResolved, isDesignatedStation, isBranchConnected, hasMaster, bankStreamReady]);
}
