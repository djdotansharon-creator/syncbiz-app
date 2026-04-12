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
  } = playback;

  const hasSource = !!currentSource;
  const hasPrevNext = Boolean(
    hasSource &&
      (queue.length > 1 ||
        (currentSource?.playlist && (currentSource.playlist.tracks?.length ?? 0) > 1)),
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
