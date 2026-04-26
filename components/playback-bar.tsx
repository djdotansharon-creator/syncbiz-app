"use client";

import { PlaybackDockSurface } from "@/components/player-surface/playback-dock-surface";
import "@/components/player-surface/playback-dock-surface.css";
import { buildBrowserPlaybackDockProps } from "@/lib/player-surface/map-browser-playback-dock";
import { usePlaybackOptional } from "@/lib/playback-provider";
import { useTranslations } from "@/lib/locale-context";

export function PlaybackBar() {
  const playback = usePlaybackOptional();
  const { t } = useTranslations();

  if (!playback) {
    return <PlaybackDockSurface variant="empty" message={t.noSourceSelected} />;
  }

  const {
    currentTrack,
    currentSource,
    status,
    volume,
    setVolume,
    play,
    pause,
    stop,
    prev,
    next,
    lastMessage,
    queue,
    playNextQueue,
    playNextBaseline,
  } = playback;

  const hasSource = !!currentSource;
  // Next/Prev should also light up when staged Play Next items exist or when we're playing
  // an ephemeral Play Next item that has a baseline waiting to resume. Without this the
  // operator gets stuck on a single dropped track because queue.length is 0 and the
  // item has no playlist attachment.
  const hasPrevNext = Boolean(
    hasSource &&
      (queue.length > 1 ||
        (currentSource?.playlist && (currentSource.playlist.tracks?.length ?? 0) > 1) ||
        (playNextQueue?.length ?? 0) > 0 ||
        !!playNextBaseline),
  );

  const statusSubtext = lastMessage
    ? t.commandSent
    : hasSource
      ? status === "playing"
        ? t.playing
        : status === "paused"
          ? t.paused
          : t.stopped
      : t.noSourceSelected;
  const titleText = hasSource ? (currentTrack?.title ?? currentSource?.title ?? "") : lastMessage || t.stopped;

  return (
    <PlaybackDockSurface
      {...buildBrowserPlaybackDockProps({
        title: titleText,
        subtitle: statusSubtext,
        volume,
        onVolumeChange: setVolume,
        hasSource,
        hasPrevNext,
        play,
        pause,
        stop,
        prev,
        next,
      })}
    />
  );
}
