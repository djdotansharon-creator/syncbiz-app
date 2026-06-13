"use client";

import { PlaybackDockSurface } from "@/components/player-surface/playback-dock-surface";
import "@/components/player-surface/playback-dock-surface.css";
import { buildBrowserPlaybackDockProps } from "@/lib/player-surface/map-browser-playback-dock";
import { usePlaybackOptional } from "@/lib/playback-provider";
import { useTranslations } from "@/lib/locale-context";
import { useDevicePlayer } from "@/lib/device-player-context";

export function PlaybackBar() {
  const playback = usePlaybackOptional();
  const deviceCtx = useDevicePlayer();
  const { t } = useTranslations();

  const isControlMirror = Boolean(
    deviceCtx?.isBranchConnected &&
      deviceCtx.deviceMode === "CONTROL" &&
      !deviceCtx.isMobileLocalPlayback,
  );

  // CONTROL mode: display the active MASTER's live state and route all
  // transport commands back to the master via the WS channel.
  if (isControlMirror) {
    const ms = deviceCtx!.masterState;
    const hasSource = !!(ms?.currentSource || ms?.currentTrack);
    const sessionTrackCount = ms?.sessionTracks?.length ?? 0;
    const hasPrevNext = sessionTrackCount > 1 || (ms?.queue?.length ?? 0) > 1;
    const titleText = ms
      ? (ms.currentTrack?.title ?? ms.currentSource?.title ?? t.noSourceSelected)
      : t.noSourceSelected;
    const remoteHint = deviceCtx!.remoteCommandMessage;
    const statusSubtext = remoteHint
      ? remoteHint
      : ms
        ? ms.status === "playing"
          ? t.playing
          : ms.status === "paused"
            ? t.paused
            : t.stopped
        : t.noSourceSelected;
    return (
      <PlaybackDockSurface
        {...buildBrowserPlaybackDockProps({
          title: titleText,
          subtitle: statusSubtext,
          volume: ms?.volume ?? 80,
          onVolumeChange: deviceCtx!.setVolumeOrSend,
          hasSource,
          hasPrevNext,
          play: deviceCtx!.playOrSend,
          pause: deviceCtx!.pauseOrSend,
          stop: deviceCtx!.stopOrSend,
          prev: deviceCtx!.prevOrSend,
          next: deviceCtx!.nextOrSend,
          pendingTransport: {
            prev: deviceCtx!.isRemoteCommandPending("PREV"),
            next: deviceCtx!.isRemoteCommandPending("NEXT"),
            play: deviceCtx!.isRemoteCommandPending("PLAY"),
            pause: deviceCtx!.isRemoteCommandPending("PAUSE"),
            stop: deviceCtx!.isRemoteCommandPending("STOP"),
          },
        })}
      />
    );
  }

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
