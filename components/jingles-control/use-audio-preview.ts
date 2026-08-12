"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser-native, OFF-PLAYBACK preview player for generated jingle/announcement MP3s.
 * A single local <audio> audition on the operator's own machine — it NEVER touches the
 * music player / MASTER / CONTROL / WS / MPV / interrupt queue / Automix. Only one preview
 * plays at a time; switching clips stops the previous; it always stops on unmount.
 * This is an audition, NOT On-Air playback to the store.
 *
 * Extracted verbatim from JinglesShell so both the customer Jingles panel and the internal
 * admin Voice Lab can share one implementation. Logic is unchanged.
 */
export function useAudioPreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
    }
    setPreviewUrl(null);
  }, []);

  const toggle = useCallback(
    (url: string) => {
      if (!url) return;
      setError(null);
      // Same clip already previewing → toggle off.
      if (audioRef.current && previewUrl === url) {
        stop();
        return;
      }
      let a = audioRef.current;
      if (!a) {
        a = new Audio();
        audioRef.current = a;
      }
      a.pause(); // stop any prior preview before starting the new one
      a.onended = () => setPreviewUrl((cur) => (cur === url ? null : cur));
      a.onerror = () => {
        setError("Preview failed to play this audio.");
        setPreviewUrl(null);
      };
      a.src = url;
      setPreviewUrl(url);
      void a.play().catch(() => {
        setError("Preview could not start (browser blocked or file error).");
        setPreviewUrl(null);
      });
    },
    [previewUrl, stop]
  );

  // Never leave preview audio running in the background after the panel closes.
  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.removeAttribute("src");
      }
    };
  }, []);

  return { previewUrl, error, toggle, stop };
}
