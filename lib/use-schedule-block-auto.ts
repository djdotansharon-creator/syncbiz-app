"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isScheduleAutoPlaybackOff,
  setScheduleAutoPlaybackOff,
  SCHEDULE_AUTO_PREFS_EVENT,
} from "@/lib/schedule-auto-preferences";

/** Per-block auto-play opt-out (browser-local), synced across components. */
export function useScheduleBlockAuto(scheduleId: string) {
  const [autoOff, setAutoOff] = useState(false);

  useEffect(() => {
    const sync = () => setAutoOff(isScheduleAutoPlaybackOff(scheduleId));
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(SCHEDULE_AUTO_PREFS_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SCHEDULE_AUTO_PREFS_EVENT, sync);
    };
  }, [scheduleId]);

  const toggle = useCallback(
    (off: boolean) => {
      setScheduleAutoPlaybackOff(scheduleId, off);
      setAutoOff(off);
    },
    [scheduleId],
  );

  return { autoPlaybackOff: autoOff, setAutoPlaybackOff: toggle };
}
