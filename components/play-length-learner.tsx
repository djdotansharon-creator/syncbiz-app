"use client";

import { useEffect, useRef } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { learnTargetOf, sameSample, type LearnTarget } from "@/lib/play-length-learn";

/** how long the same song with the same length must stay on screen before it is remembered (a track change in between cancels it) */
const CONFIRM_MS = 4000;
/** one report per song per page: the server keeps the first length it was given, so asking again changes nothing */
const reported = new Set<string>();

/**
 * Remembers a song's real length the first time it plays (lib/play-length-learn.ts). Reads the station's mirrored status (`masterState`: the song, the playlist behind it, the length and the position the PLAYER reports),
 * and sends numbers only to `POST /api/playlists/:id/track-durations`. Renders nothing; touches no playback; a failed report is simply dropped (the next play of the song tries once more on a fresh page).
 */
export function PlayLengthLearner() {
  const ms = useDevicePlayer()?.masterState ?? null;
  const msRef = useRef(ms);
  useEffect(() => {
    msRef.current = ms;
  });
  const t = learnTargetOf(ms);
  const key = t ? `${t.playlistId}|${t.trackId}|${t.seconds}` : "";

  useEffect(() => {
    if (!key) return;
    const first: LearnTarget | null = learnTargetOf(msRef.current);
    const timer = window.setTimeout(() => {
      const again = learnTargetOf(msRef.current);
      if (!first || !again || !sameSample(first, again)) return;
      const k = `${again.playlistId}:${again.trackId}`;
      if (reported.has(k)) return;
      reported.add(k);
      void fetch(`/api/playlists/${encodeURIComponent(again.playlistId)}/track-durations`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durations: { [again.trackId]: again.seconds } }),
      }).catch(() => {
        /* a failed report is dropped */
      });
    }, CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [key]);

  return null;
}
