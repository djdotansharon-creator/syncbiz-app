"use client";

import { useMemo } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { useStationController } from "@/lib/station-controller-context";
import { displayPlaybackState, holdsAudible } from "@/lib/url-transition-intent";

/**
 * P0 Gate 1f — what the PHONE (StationControllerContext mirror) presents as now playing / loading.
 *
 * The phone starts transitions from two layers: library selections go through DevicePlayerContext
 * (`playSourceOrSend`), transport NEXT / PREV through StationControllerContext. The display follows whichever
 * transition currently holds the audible item, so the same rule applies to both (lib/url-transition-intent.ts).
 */
export function useStationDisplay() {
  const station = useStationController();
  const device = useDevicePlayer();
  const stationT = station.transition;
  const deviceT = device?.urlTransition ?? null;
  const stationHeld = station.transitionHeldState;
  const deviceHeld = device?.urlTransitionHeldState ?? null;
  const live = station.remoteState;
  return useMemo(() => {
    const useStation = holdsAudible(stationT) || (!holdsAudible(deviceT) && !!stationT);
    const transition = useStation ? stationT : deviceT;
    const held = useStation ? stationHeld : deviceHeld;
    return { ...displayPlaybackState(live, held, transition), transition };
  }, [live, stationT, deviceT, stationHeld, deviceHeld]);
}
