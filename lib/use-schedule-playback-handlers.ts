"use client";

import { useCallback, useMemo } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import type { SchedulePlaybackHandlers } from "@/lib/schedule-playback-client";
import { usePlayback } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * Schedule "Play now" / auto-play must use the same routing as the rest of the app:
 * local `playSource` when standalone or MASTER; `PLAY_SOURCE` to the station when this tab is CONTROL.
 */
export function useSchedulePlaybackHandlers(): SchedulePlaybackHandlers {
  const { stop, setQueue, playSource: rawPlaySource, setLastMessage } = usePlayback();
  const device = useDevicePlayer();

  const playSource = useCallback(
    (source: UnifiedSource, trackIndex?: number) => {
      if (device?.isBranchConnected && device.deviceMode === "CONTROL") {
        device.playSourceOrSend(source, trackIndex ?? 0);
      } else {
        rawPlaySource(source, trackIndex);
      }
    },
    [device, rawPlaySource],
  );

  return useMemo(
    () => ({ stop, setQueue, playSource, setLastMessage }),
    [stop, setQueue, playSource, setLastMessage],
  );
}
