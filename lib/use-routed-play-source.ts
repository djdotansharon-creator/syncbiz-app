"use client";

import { useCallback } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { usePlayback } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * Schedule / CONTROL tab: same routing as the rest of the app —
 * local `playSource` when standalone or MASTER; send to MASTER when this tab is CONTROL.
 */
export function useRoutedPlaySource() {
  const { playSource: rawPlaySource } = usePlayback();
  const device = useDevicePlayer();

  return useCallback(
    (source: UnifiedSource, trackIndex?: number) => {
      if (device?.isBranchConnected && device.deviceMode === "CONTROL") {
        device.playSourceOrSend(source, trackIndex ?? 0);
      } else {
        rawPlaySource(source, trackIndex);
      }
    },
    [device, rawPlaySource],
  );
}
