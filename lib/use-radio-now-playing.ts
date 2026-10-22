"use client";

import { useEffect, useState } from "react";

const POLL_MS = 20_000;

/**
 * The song a radio station is broadcasting ("Artist - Title"), polled from /api/radio/[id]/now-playing every
 * 20 s while `active` and the tab is visible. Display only — never touches playback state.
 */
export function useRadioNowPlaying(stationId: string | null, active: boolean): string | null {
  const [state, setState] = useState<{ id: string; title: string | null } | null>(null);

  useEffect(() => {
    if (!stationId || !active) return;
    let cancelled = false;
    const load = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetch(`/api/radio/${encodeURIComponent(stationId)}/now-playing`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { title?: string | null } | null) => {
          if (!cancelled) setState({ id: stationId, title: data?.title ?? null });
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stationId, active]);

  return stationId && active && state?.id === stationId ? state.title : null;
}
