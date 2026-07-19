"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useMobileRole } from "@/lib/mobile-role-context";
import { useStationController } from "@/lib/station-controller-context";
import { usePlayback } from "@/lib/playback-provider";
import { useLocalPlaybackTime } from "@/lib/playback-time-store";
import {
  getAutoMix,
  setAutoMix as persistAutoMix,
  onAutoMixChanged,
} from "@/lib/mix-preferences";
import {
  isIOS,
  primeIOSFromGesture,
  setIOSNeedsTapToResume,
} from "@/lib/ios-audio-unlock";

/**
 * Shared player derivation + visual tokens for BOTH mobile surfaces
 * (Now Playing sheet + Mini player) and the shared `MobileTransportControls`.
 *
 * The transport LOGIC lives here once so every mobile surface drives the exact
 * same actions/state as the main SyncBiz player:
 *   - player mode     → the same `usePlayback()` provider the desktop deck uses,
 *                       plus AutoMix via `lib/mix-preferences` (shared app-wide).
 *   - controller mode → the same `useStationController()` remote commands the
 *                       desktop control-mirror uses. Random/AutoMix send the
 *                       existing SET_SHUFFLE / SET_AUTOMIX RemoteCommands; the
 *                       MASTER executes and echoes state back via STATE_UPDATE.
 *
 * NO new playback logic is created here — this only wires existing actions.
 */
export type MobilePlayerDerived = {
  mode: "controller" | "player";
  canControl: boolean;
  hasSource: boolean;
  isPlaying: boolean;
  title: string;
  subtitle: string | null;
  cover: string | null;
  position: number;
  duration: number;
  volume: number;
  /** Random/shuffle ON state (mirrors MASTER in controller mode). */
  shuffle: boolean;
  /** AutoMix/crossfade ON state (mirrors MASTER in controller mode). */
  autoMix: boolean;
  /** Whether Random/Mix toggles are actionable (player: always; controller: MASTER connected). */
  canToggleModes: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (value: number) => void;
  onToggleShuffle: () => void;
  onToggleAutoMix: () => void;
};

function useDerivedPlayer(): MobilePlayerDerived {
  const { mobileRole } = useMobileRole();
  const station = useStationController();
  const playback = usePlayback();
  const localTime = useLocalPlaybackTime();

  // AutoMix is an app-wide preference (lib/mix-preferences); the real AudioPlayer
  // in app-shell reads the same store, so toggling it here in PLAYER mode drives
  // the actual crossfade engine. useSyncExternalStore keeps the button in sync
  // (same pattern as the main player's transport) with no set-state-in-effect.
  const autoMixPref = useSyncExternalStore(
    (cb) => onAutoMixChanged(cb),
    () => getAutoMix(),
    () => false,
  );

  // iOS Safari first-gesture unlock primer.
  // The <audio> element used in mobile PLAYER mode lives in a hidden container
  // in app-shell, so the user can never tap it directly. iOS requires
  // audio.play() to run synchronously inside a gesture handler for the very
  // first activation. We attach a one-shot pointerdown listener whenever
  // mobileRole is "player" so the FIRST tap anywhere primes the audio element.
  useEffect(() => {
    if (mobileRole !== "player") return;
    if (typeof window === "undefined") return;
    if (!isIOS()) return;
    const onFirstGesture = () => {
      primeIOSFromGesture();
    };
    window.addEventListener("pointerdown", onFirstGesture, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture, { capture: true } as EventListenerOptions);
    };
  }, [mobileRole]);

  if (mobileRole === "controller") {
    const rs = station.remoteState;
    const canControl = station.isCrossDevice;
    const src = rs?.currentSource ?? null;
    const trk = rs?.currentTrack ?? null;
    const status = rs?.status ?? "idle";
    const isPlaying = canControl && status === "playing";
    return {
      mode: "controller",
      canControl,
      hasSource: canControl && !!src,
      isPlaying,
      title: canControl ? trk?.title ?? src?.title ?? "No playback" : "Connect a player",
      subtitle:
        canControl && src?.title && trk?.title !== src.title
          ? src.title
          : canControl
            ? null
            : "Go to the Remote tab to pick a MASTER device",
      cover: canControl ? trk?.cover ?? src?.cover ?? null : null,
      position: rs?.position ?? 0,
      duration: rs?.duration ?? 0,
      volume: typeof rs?.volume === "number" ? rs.volume : 80,
      // Mirror the MASTER's mode state; only meaningful when connected.
      shuffle: canControl ? !!rs?.shuffle : false,
      autoMix: canControl ? !!rs?.autoMix : false,
      canToggleModes: canControl,
      onPlayPause: () => {
        if (!canControl) return;
        if (isPlaying) station.sendPause();
        else station.sendPlay();
      },
      onStop: () => {
        if (canControl) station.sendStop();
      },
      onNext: () => {
        if (canControl) station.sendNext();
      },
      onPrev: () => {
        if (canControl) station.sendPrev();
      },
      onSeek: (seconds: number) => {
        if (canControl) station.sendSeek(seconds);
      },
      onVolume: (value: number) => {
        if (canControl) station.sendSetVolume(value);
      },
      // Send the ABSOLUTE desired value to the MASTER (never a local flip): the
      // displayed state comes only from remoteState, so double-clicks can't
      // desync. The MASTER executes and echoes the new state via STATE_UPDATE.
      onToggleShuffle: () => {
        if (canControl) station.sendSetShuffle(!rs?.shuffle);
      },
      onToggleAutoMix: () => {
        if (canControl) station.sendSetAutoMix(!rs?.autoMix);
      },
    };
  }

  const src = playback.currentSource;
  const trk = playback.currentTrack;
  const isPlaying = playback.status === "playing";
  return {
    mode: "player",
    canControl: true,
    hasSource: !!src,
    isPlaying,
    title: trk?.title ?? src?.title ?? "Nothing playing",
    subtitle: src?.title && trk?.title !== src.title ? src.title : null,
    cover: trk?.cover ?? src?.cover ?? null,
    position: localTime.position,
    duration: localTime.duration,
    volume: playback.volume,
    shuffle: playback.shuffle,
    autoMix: autoMixPref,
    canToggleModes: true,
    onPlayPause: () => {
      if (!src) return;
      if (isPlaying) {
        playback.pause();
        return;
      }
      // iOS Safari: call audio.play() *synchronously* inside this gesture handler
      // so the <audio> element is activated before AudioPlayer's status-driven
      // useEffect runs. No-op on non-iOS UAs.
      primeIOSFromGesture();
      setIOSNeedsTapToResume(false);
      playback.play();
    },
    onStop: () => {
      if (src) playback.stop();
    },
    onNext: () => {
      if (src) playback.next();
    },
    onPrev: () => {
      if (src) playback.prev();
    },
    onSeek: (seconds: number) => {
      if (src) playback.seekTo(seconds);
    },
    onVolume: (value: number) => {
      playback.setVolume(value);
    },
    // Same actions the main player uses: shuffle via the playback provider,
    // AutoMix via the shared mix-preferences store (drives the real engine).
    onToggleShuffle: () => playback.toggleShuffle(),
    // persistAutoMix updates the shared store; useSyncExternalStore re-reads it.
    onToggleAutoMix: () => persistAutoMix(!autoMixPref),
  };
}

/** Shared by the mini-player, the Now Playing sheet, and MobileTransportControls. */
export function useMobilePlayer(): MobilePlayerDerived {
  return useDerivedPlayer();
}

// Visual tokens — mirror the main SyncBiz player's deck transport (the cyan
// "neon pill" language from `.library-deck-neon-btn:not(.h-7)` in
// `app/globals.css`). Controller and Player modes share ONE look; mode is
// communicated only through the mode pill and volume label, never through
// different accent colors.
//
// Corner radius is intentionally NOT baked in — each caller sets its own so the
// *visual proportion* matches across sizes (mini 12px on h-9 ≈ 33%, sheet 16px
// on h-[3.25rem] ≈ 31%).
export const MOBILE_TRANSPORT_SEC =
  "flex shrink-0 items-center justify-center border-2 border-cyan-400/65 bg-slate-900/95 text-cyan-300 transition shadow-[0_0_0_1px_rgba(34,211,238,0.28),0_0_24px_-4px_rgba(34,211,238,0.42)] hover:border-cyan-300 hover:text-cyan-100 hover:shadow-[0_0_0_2px_rgba(34,211,238,0.55),0_0_32px_-4px_rgba(34,211,238,0.55)] active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/60";

export const MOBILE_TRANSPORT_PRIMARY =
  "flex shrink-0 items-center justify-center border-2 border-cyan-400/75 bg-slate-900/95 text-cyan-200 transition shadow-[0_0_0_2px_rgba(34,211,238,0.5),0_0_32px_-2px_rgba(34,211,238,0.55),0_0_60px_-10px_rgba(34,211,238,0.35)] hover:border-cyan-300 hover:text-cyan-100 hover:shadow-[0_0_0_2px_rgba(34,211,238,0.75),0_0_40px_-2px_rgba(34,211,238,0.7),0_0_72px_-10px_rgba(34,211,238,0.45)] active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/70";

// Mode toggle (Random / AutoMix) — same neon family, but ACTIVE state fills
// cyan so ON/OFF is unmistakable (matches the main player's active-tint idea).
export const MOBILE_TOGGLE_OFF =
  "flex shrink-0 items-center justify-center border-2 border-slate-600/70 bg-slate-900/80 text-slate-400 transition hover:border-cyan-400/60 hover:text-cyan-200 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/60";

export const MOBILE_TOGGLE_ON =
  "flex shrink-0 items-center justify-center border-2 border-cyan-400/80 bg-cyan-400/20 text-cyan-100 transition shadow-[0_0_0_1px_rgba(34,211,238,0.4),0_0_22px_-4px_rgba(34,211,238,0.6)] active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/70";
