"use client";

import {
  PlaybackTransportIconNext,
  PlaybackTransportIconPause,
  PlaybackTransportIconPlay,
  PlaybackTransportIconPrev,
  PlaybackTransportIconStop,
} from "@/components/player-surface/playback-transport-icons";
import {
  MOBILE_TRANSPORT_PRIMARY,
  MOBILE_TRANSPORT_SEC,
  MOBILE_TOGGLE_OFF,
  MOBILE_TOGGLE_ON,
  type MobilePlayerDerived,
} from "@/components/mobile/mobile-player-core";

/** Random = dice glyph — identical to the main player's ShuffleToggleButton. */
function RandomIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8.4" cy="8.4" r="1.5" fill="currentColor" />
      <circle cx="15.6" cy="8.4" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="8.4" cy="15.6" r="1.5" fill="currentColor" />
      <circle cx="15.6" cy="15.6" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Mix = crossfade waveform — identical glyph to the main player's Automix button. */
function MixIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 12h4l3-7 4 14 3-7h2" />
    </svg>
  );
}

/**
 * Shared transport cluster for BOTH mobile surfaces (Now Playing sheet + Mini
 * player). All actions/state come from `MobilePlayerDerived` — identical to the
 * main SyncBiz player (Play/Pause/Stop/Prev/Next + Random/Mix ON/OFF). Only the
 * LAYOUT differs by `variant`; there is no duplicated playback logic.
 *
 *   - "sheet": hero transport row (Prev · Stop · [wide Play] · Next) + a labeled
 *              mode row (Random · Mix). Two rows so six controls never overflow
 *              a narrow (375px) sheet.
 *   - "mini":  one compact row (Prev · Stop · Play · Next · Random · Mix) sized
 *              to fit beside the artwork/title without wrapping or clipping.
 *
 * `stopParentTap` (mini) stops the tap from bubbling to the "open sheet" button.
 */
export function MobileTransportControls({
  d,
  variant,
}: {
  d: MobilePlayerDerived;
  variant: "sheet" | "mini";
}) {
  const transportDisabled = !d.canControl || !d.hasSource;
  const modeDisabled = !d.canToggleModes;
  const stopParentTap = variant === "mini";

  const tap = (fn: () => void) => (e: React.MouseEvent) => {
    if (stopParentTap) e.stopPropagation();
    fn();
  };

  if (variant === "mini") {
    // Compact single row. Sizes tuned so Prev·Stop·Play·Next·Random·Mix fit
    // beside a 44px artwork + truncating title on a 375px-wide phone.
    const sec = "h-9 w-9 rounded-xl";
    const secIcon = "h-4 w-4";
    return (
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={tap(d.onPrev)} disabled={transportDisabled} aria-label="Previous" className={`${MOBILE_TRANSPORT_SEC} ${sec}`}>
          <PlaybackTransportIconPrev className={secIcon} />
        </button>
        <button type="button" onClick={tap(d.onStop)} disabled={transportDisabled} aria-label="Stop" className={`${MOBILE_TRANSPORT_SEC} ${sec}`}>
          <PlaybackTransportIconStop className={secIcon} />
        </button>
        <button
          type="button"
          onClick={tap(d.onPlayPause)}
          disabled={!d.canControl || !d.hasSource}
          aria-label={d.isPlaying ? "Pause" : "Play"}
          className={`${MOBILE_TRANSPORT_PRIMARY} h-10 w-10 rounded-full`}
        >
          {d.isPlaying ? <PlaybackTransportIconPause className="h-5 w-5" /> : <PlaybackTransportIconPlay className="ml-0.5 h-5 w-5" />}
        </button>
        <button type="button" onClick={tap(d.onNext)} disabled={transportDisabled} aria-label="Next" className={`${MOBILE_TRANSPORT_SEC} ${sec}`}>
          <PlaybackTransportIconNext className={secIcon} />
        </button>
        <button
          type="button"
          onClick={tap(d.onToggleShuffle)}
          disabled={modeDisabled}
          aria-label="Random"
          aria-pressed={d.shuffle}
          className={`${d.shuffle ? MOBILE_TOGGLE_ON : MOBILE_TOGGLE_OFF} ${sec}`}
        >
          <RandomIcon className={secIcon} />
        </button>
        <button
          type="button"
          onClick={tap(d.onToggleAutoMix)}
          disabled={modeDisabled}
          aria-label="Mix"
          aria-pressed={d.autoMix}
          className={`${d.autoMix ? MOBILE_TOGGLE_ON : MOBILE_TOGGLE_OFF} ${sec}`}
        >
          <MixIcon className={secIcon} />
        </button>
      </div>
    );
  }

  // sheet
  return (
    <div className="flex flex-col items-center gap-4">
      {/* Hero transport row */}
      <div className="flex items-center justify-center gap-2.5">
        <button type="button" onClick={d.onPrev} disabled={transportDisabled} aria-label="Previous" className={`${MOBILE_TRANSPORT_SEC} h-[3.25rem] w-[3.25rem] rounded-2xl`}>
          <PlaybackTransportIconPrev className="h-6 w-6" />
        </button>
        <button type="button" onClick={d.onStop} disabled={transportDisabled} aria-label="Stop" className={`${MOBILE_TRANSPORT_SEC} h-[3.25rem] w-[3.25rem] rounded-2xl`}>
          <PlaybackTransportIconStop className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={d.onPlayPause}
          disabled={!d.canControl || !d.hasSource}
          aria-label={d.isPlaying ? "Pause" : "Play"}
          className={`${MOBILE_TRANSPORT_PRIMARY} h-[3.75rem] w-[3.75rem] rounded-full`}
        >
          {d.isPlaying ? <PlaybackTransportIconPause className="h-7 w-7" /> : <PlaybackTransportIconPlay className="ml-0.5 h-7 w-7" />}
        </button>
        <button type="button" onClick={d.onNext} disabled={transportDisabled} aria-label="Next" className={`${MOBILE_TRANSPORT_SEC} h-[3.25rem] w-[3.25rem] rounded-2xl`}>
          <PlaybackTransportIconNext className="h-6 w-6" />
        </button>
      </div>

      {/* Mode row — Random / Mix as labeled pills so ON/OFF is unmistakable. */}
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={d.onToggleShuffle}
          disabled={modeDisabled}
          aria-label="Random"
          aria-pressed={d.shuffle}
          className={`${d.shuffle ? MOBILE_TOGGLE_ON : MOBILE_TOGGLE_OFF} h-11 gap-2 rounded-full px-4 text-[11px] font-semibold uppercase tracking-[0.12em]`}
        >
          <RandomIcon className="h-[18px] w-[18px]" />
          Random
        </button>
        <button
          type="button"
          onClick={d.onToggleAutoMix}
          disabled={modeDisabled}
          aria-label="Mix"
          aria-pressed={d.autoMix}
          className={`${d.autoMix ? MOBILE_TOGGLE_ON : MOBILE_TOGGLE_OFF} h-11 gap-2 rounded-full px-4 text-[11px] font-semibold uppercase tracking-[0.12em]`}
        >
          <MixIcon className="h-[18px] w-[18px]" />
          Mix
        </button>
      </div>
    </div>
  );
}
