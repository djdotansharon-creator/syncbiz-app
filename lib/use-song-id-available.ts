"use client";

import { useEffect, useState } from "react";

/**
 * Is "identify a song" switched on for this deployment? Two independent server flags (both off by default, so the feature stays hidden until someone configures it):
 *   · `mic`    — hearing a song through the phone's microphone (needs AUDD_API_TOKEN on the server)
 *   · `shazam` — pasting a Shazam link (needs SYNCBIZ_SHAZAM_IMPORT_ENABLED)
 * `null` = still asking. The screens use it to show a door only when something is behind it, and to say so plainly instead of drawing an empty screen.
 */
export type SongIdAvailability = { mic: boolean | null; shazam: boolean | null; any: boolean | null };

const ask = (url: string): Promise<boolean> =>
  fetch(url, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .then((d: { enabled?: boolean }) => !!d?.enabled)
    .catch(() => false);

export function useSongIdAvailable(): SongIdAvailability {
  const [v, setV] = useState<{ mic: boolean; shazam: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([ask("/api/config/mic-recognition"), ask("/api/config/shazam-import")]).then(([mic, shazam]) => {
      if (alive) setV({ mic, shazam });
    });
    return () => {
      alive = false;
    };
  }, []);
  return { mic: v?.mic ?? null, shazam: v?.shazam ?? null, any: v ? v.mic || v.shazam : null };
}
