"use client";

import { useMemo } from "react";
import type { SchedulePlaybackHandlers } from "@/lib/schedule-playback-client";
import { usePlayback } from "@/lib/playback-provider";
import { useRoutedPlaySource } from "@/lib/use-routed-play-source";

/**
 * Schedule "Play now" / auto-play must use the same routing as the rest of the app:
 * local `playSource` when standalone or MASTER; `PLAY_SOURCE` to the station when this tab is CONTROL.
 */
export function useSchedulePlaybackHandlers(): SchedulePlaybackHandlers {
  const { stop, setQueue, setLastMessage } = usePlayback();
  const playSource = useRoutedPlaySource();

  return useMemo(
    () => ({ stop, setQueue, playSource, setLastMessage }),
    [stop, setQueue, playSource, setLastMessage],
  );
}
