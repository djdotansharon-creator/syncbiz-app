"use client";

import { useEffect, useRef } from "react";
import { usePlaybackOptional } from "@/lib/playback-provider";

/**
 * Controller-only player: sends play/stop commands to the backend.
 * Does NOT use YouTube iframe API or in-browser media.
 * Play: POST /api/commands/play-local with target URL/path → cmd /c start "" "<target>"
 * Stop: POST /api/commands/stop-local → taskkill /IM winamp.exe /F
 */
export function Player() {
  const playback = usePlaybackOptional();
  if (!playback) return null;

  const { currentSource, status, setLastMessage } = playback;
  const lastPlayTargetRef = useRef<string | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  // When status is "playing" and we have a source, send URL/path to play-local (once per source)
  useEffect(() => {
    if (!currentSource || status !== "playing") return;

    const target = (
      currentSource.source?.target ??
      currentSource.source?.uriOrPath ??
      currentSource.url ??
      ""
    ).trim();
    if (!target) return;

    // Only send play once per target when entering playing state
    if (lastPlayTargetRef.current === target) return;
    lastPlayTargetRef.current = target;

    const browserPreference = currentSource.source?.browserPreference ?? "default";

    fetch("/api/commands/play-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target,
        browserPreference,
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          setLastMessage("Local playback command sent");
          return;
        }
        const data = await res.json().catch(() => ({}));
        setLastMessage(data?.error ? `Failed: ${data.error}` : "Playback failed.");
      })
      .catch((err) => {
        setLastMessage(`Failed: ${err instanceof Error ? err.message : "Network error"}`);
      });
  }, [currentSource, status, setLastMessage]);

  // When transitioning to "stopped", send stop-local (taskkill winamp)
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if (prev !== "stopped" && status === "stopped") {
      lastPlayTargetRef.current = null;
      fetch("/api/commands/stop-local", { method: "POST" })
        .then(async (res) => {
          if (res.ok) {
            setLastMessage("Local stop command sent");
            return;
          }
          const data = await res.json().catch(() => ({}));
          setLastMessage(data?.error ? `Failed: ${data.error}` : "Stop failed.");
        })
        .catch((err) => {
          setLastMessage(`Failed: ${err instanceof Error ? err.message : "Network error"}`);
        });
    }
  }, [status, setLastMessage]);

  // Clear play target when source is cleared
  useEffect(() => {
    if (!currentSource) lastPlayTargetRef.current = null;
  }, [currentSource]);

  return null;
}
