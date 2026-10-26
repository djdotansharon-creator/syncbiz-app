"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActionButtonShare, ActionButtonEdit } from "@/components/ui/action-buttons";
import {
  MIX_DURATIONS,
  getMixDuration,
  setMixDuration,
  onMixDurationChanged,
  getRepeatMode,
  setRepeatMode,
  onRepeatModeChanged,
  type MixDuration,
  type RepeatMode,
} from "@/lib/mix-preferences";
import {
  PlaybackTransportIconNext,
  PlaybackTransportIconPlayPause,
  PlaybackTransportIconPrev,
  PlaybackTransportIconStop,
} from "@/components/player-surface/playback-transport-icons";
import type { PlayerDeckTransportSurfaceProps } from "@/lib/player-surface/player-deck-transport-types";
import { useTr } from "@/lib/i18n/use-tr";

/** Owner 2026-10-18: no pencil in the player itself — editing lives in the song list (code kept, flip to show again). */
const SHOW_PLAYER_EDIT = false;

/**
 * Transport dock — CDJ-inspired layout with inviting SyncBiz playback controls.
 */
export function PlayerDeckTransportSurface(props: PlayerDeckTransportSurfaceProps) {
  const {
    variant,
    onPrev,
    onStop,
    onPlayPause,
    onNext,
    prevNextDisabled,
    contentDisabled,
    isPlaying,
    onAutoMixToggle,
    onShuffleToggle,
    displayAutoMix,
    displayShuffle,
    onShareClick,
    shareDisabled,
    editHref,
    onEditClick,
    secondaryExtra,
    labels,
  } = props;

  const libDeck = variant === "library-deck";

  // The play/pause glyph answers the click at once (owner 2026-10-18: the morph must feel instant, slow and smooth):
  // the real status can lag ~100–300ms behind the click (engine round-trip), so the icon flips optimistically and
  // follows the real status the moment it changes (or snaps back after 1.6s if the command never took effect). UI only.
  const [ppPending, setPpPending] = useState<{ from: boolean; want: boolean } | null>(null);
  const shownPlaying = ppPending && ppPending.from === isPlaying ? ppPending.want : isPlaying;
  const handlePlayPause = () => {
    setPpPending({ from: isPlaying, want: !isPlaying });
    window.setTimeout(() => setPpPending(null), 1600);
    onPlayPause();
  };

  // 2026-10-16 (owner): the transport block sits on the centre of the SCREEN, not of the player (the player
  // is pushed right by the queue card). The row measures its own offset and publishes the width of its
  // first grid column so the PLAY button lands on 50vw — clamped so the shuffle wing always keeps room
  // (then it degrades to the symmetric in-player layout). Pure layout: a CSS variable, no state.
  const rowRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof window === "undefined") return;
    const MIN_WING_PX = 64;
    let last = "";
    const apply = () => {
      const cluster = row.querySelector<HTMLElement>(".player-transport-cluster");
      if (!cluster) return;
      const r = row.getBoundingClientRect();
      const c = cluster.getBoundingClientRect();
      if (r.width <= 0 || c.width <= 0) return;
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const rtl = getComputedStyle(row).direction === "rtl";
      const primary = cluster.children[2] as HTMLElement | undefined; // stop · prev · PLAY · next
      const p = primary ? primary.getBoundingClientRect() : c;
      const anchorX = p.left + p.width / 2;
      const anchorFromStart = rtl ? c.right - anchorX : anchorX - c.left;
      const vwCenter = window.innerWidth / 2;
      const wanted = rtl ? r.right - vwCenter - anchorFromStart - gap : vwCenter - r.left - anchorFromStart - gap;
      const max = r.width - c.width - gap * 2 - MIN_WING_PX;
      let next = "";
      if (max > MIN_WING_PX) next = `${Math.round(Math.min(max, Math.max(MIN_WING_PX, wanted)))}px`;
      if (next === last) return;
      last = next;
      if (next) row.style.setProperty("--sb-tr-col1", next);
      else row.style.removeProperty("--sb-tr-col1");
    };
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => apply()) : null;
    ro?.observe(row);
    if (ro && row.parentElement) ro.observe(row.parentElement);
    window.addEventListener("resize", apply);
    const id = window.setInterval(apply, 1000); // cheap safety net for layout shifts the observer can't see
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", apply);
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="player-transport-dock w-full min-w-0">
      {/* 2026-10-15 (owner): a three-column row — the transport block (stop · prev · play · next) sits in the
          exact centre of the player; the two mode toggles mirror each other on either side (shuffle left,
          loop right); edit/share stay quiet at the far right. The Automix pill is off the display only
          (`.sb-automix-pill`, code kept) while the new AutoMix engine is being built. */}
      <div ref={rowRef} className="player-transport-dock__row sb-transport-grid w-full min-w-0 items-center border-t border-white/[0.04] pt-3">
        <div className="sb-transport-wing sb-transport-wing--start flex min-w-0 items-center justify-end gap-2 sm:gap-3">
          <ShuffleToggleButton
            active={displayShuffle}
            disabled={contentDisabled}
            onClick={onShuffleToggle}
            ariaLabel={labels.random}
            title={labels.random}
          />
        </div>

        <div className="player-transport-cluster flex shrink-0 items-center gap-3 sm:gap-4">
          <DeckTransportButton
            onClick={onStop}
            disabled={contentDisabled}
            ariaLabel={labels.stopPlayback}
            title={labels.stopPlayback}
            size="stop"
            libraryDeck={libDeck}
            className="me-1 sm:me-2"
          >
            <PlaybackTransportIconStop className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </DeckTransportButton>

          <DeckTransportButton
            onClick={onPrev}
            disabled={prevNextDisabled}
            ariaLabel={labels.previousTrack}
            title={labels.previousTrack}
            size="nav"
            libraryDeck={libDeck}
          >
            <PlaybackTransportIconPrev className="h-5 w-5 sm:h-6 sm:w-6" />
          </DeckTransportButton>

          <DeckTransportButton
            onClick={handlePlayPause}
            disabled={contentDisabled}
            active={isPlaying}
            primary
            ariaLabel={isPlaying ? labels.pausePlayback : labels.play}
            title={isPlaying ? labels.pausePlayback : labels.play}
            libraryDeck={libDeck}
            className={libDeck && isPlaying ? "library-player-play-emerald" : undefined}
          >
            <span className="relative flex h-7 w-7 items-center justify-center sm:h-8 sm:w-8" aria-hidden>
              <PlaybackTransportIconPlayPause playing={shownPlaying} className="sb-pp-main absolute" />
            </span>
          </DeckTransportButton>

          <DeckTransportButton
            onClick={onNext}
            disabled={prevNextDisabled}
            ariaLabel={labels.next}
            title={labels.next}
            size="nav"
            libraryDeck={libDeck}
          >
            <PlaybackTransportIconNext className="h-5 w-5 sm:h-6 sm:w-6" />
          </DeckTransportButton>
        </div>

        <div className="sb-transport-wing sb-transport-wing--end flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Loop is a mode preference — usable even before anything is loaded */}
          <LoopToggleButton />

          <span className="sb-automix-pill contents">
            <AutoMixToggleButton
              active={displayAutoMix}
              disabled={contentDisabled}
              onClick={onAutoMixToggle}
              ariaLabel={labels.autoMix}
              title={labels.autoMix}
            />
          </span>

        <div className="player-transport-secondary ms-auto flex shrink-0 items-center gap-1.5 opacity-25 transition-opacity duration-200 hover:opacity-50 focus-within:opacity-50">
          {!SHOW_PLAYER_EDIT ? null : onEditClick ? (
            <ActionButtonEdit onClick={onEditClick} variant="player" aria-label={labels.edit} title={labels.edit} />
          ) : editHref ? (
            <ActionButtonEdit href={editHref} variant="player" aria-label={labels.edit} title={labels.edit} />
          ) : null}
          {libDeck ? (
            <ActionButtonShare variant="player" onClick={onShareClick} disabled={shareDisabled} aria-label={labels.share} title="" />
          ) : (
            <button
              type="button"
              onClick={onShareClick}
              disabled={shareDisabled}
              aria-label={labels.share}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-30"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
          )}
          {secondaryExtra}
        </div>
        </div>
      </div>
    </div>
  );
}

/** Inviting SyncBiz playback control — soft neon accent, restrained premium feel. */
function DeckTransportButton({
  onClick,
  disabled,
  active,
  primary,
  size = "nav",
  libraryDeck,
  ariaLabel,
  title,
  className,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
  size?: "stop" | "nav";
  libraryDeck?: boolean;
  ariaLabel: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const accent = libraryDeck ? "cyan" : "emerald";

  const dim =
    size === "stop"
      ? "h-8 w-8 rounded-lg"
      : primary
        ? "h-11 w-11 rounded-full sm:h-12 sm:w-12"
        : "h-10 w-10 rounded-xl sm:h-11 sm:w-11";

  const tone = primary
    ? active
      ? accent === "cyan"
        ? "deck-transport-btn--play-active"
        : "deck-transport-btn--play-active deck-transport-btn--accent-emerald"
      : accent === "cyan"
        ? "deck-transport-btn--play"
        : "deck-transport-btn--play deck-transport-btn--accent-emerald"
    : size === "stop"
      ? "deck-transport-btn--stop"
      : accent === "cyan"
        ? "deck-transport-btn--nav"
        : "deck-transport-btn--nav deck-transport-btn--accent-emerald";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`deck-transport-btn inline-flex shrink-0 items-center justify-center transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/12 disabled:opacity-35 disabled:pointer-events-none ${dim} ${tone}${className ? ` ${className}` : ""}`}
    >
      {children}
    </button>
  );
}

/** Shuffle — clean standard icon, quiet circle; blue tint when on. */
function ShuffleToggleButton({
  active,
  disabled,
  onClick,
  ariaLabel,
  title,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-[color,transform] duration-300 ease-out hover:scale-[1.14] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-35 ${
        active
          ? "bg-white/[0.14] text-white"
          : "text-[#8e8e93] hover:text-[#f5f5f7]"
      }`}
    >
      {/* Random = dice — unmistakable, reads as "random" to anyone */}
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="8.4" cy="8.4" r="1.5" fill="currentColor" />
        <circle cx="15.6" cy="8.4" r="1.5" fill="currentColor" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        <circle cx="8.4" cy="15.6" r="1.5" fill="currentColor" />
        <circle cx="15.6" cy="15.6" r="1.5" fill="currentColor" />
      </svg>
    </button>
  );
}

/**
 * LOOP — one button, three states (cycled by click):
 *   playlist → the whole playlist loops (default behavior);
 *   track    → the playing song repeats;
 *   off      → playback stops after the last track.
 * Shared via lib/mix-preferences so the playback engine reads the same value.
 */
function LoopToggleButton({ disabled }: { disabled?: boolean }) {
  const tr = useTr();
  const mode = useSyncExternalStore(
    (onStoreChange) => onRepeatModeChanged(() => onStoreChange()),
    () => getRepeatMode(),
    () => "playlist" as RepeatMode,
  );

  const nextMode: RepeatMode = mode === "playlist" ? "track" : mode === "track" ? "off" : "playlist";
  const label =
    mode === "playlist" ? tr("Loop: playlist") : mode === "track" ? tr("Loop: this song") : tr("Loop: off");
  const activeCls =
    mode === "off"
      ? "text-[#8e8e93] hover:text-[#f5f5f7]"
            : "bg-white/[0.14] text-white";

  return (
    <button
      type="button"
      onClick={() => setRepeatMode(nextMode)}
      disabled={disabled}
      aria-label={label}
      title={`${label} — ${tr("click to change")}`}
      className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-[color,transform] duration-300 ease-out hover:scale-[1.14] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-35 ${activeCls}`}
    >
      {/* Universal repeat glyph */}
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
      </svg>
      {mode === "track" ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold leading-none text-black">
          1
        </span>
      ) : null}
    </button>
  );
}

/**
 * AutoMix — professional split pill:
 *   left side toggles AutoMix on/off; right side shows the crossfade length
 *   and opens a clean picker (3/6/9/12s) — no trip to Settings needed.
 * Duration is shared app-wide via lib/mix-preferences (Settings stays in sync).
 */
function AutoMixToggleButton({
  active,
  disabled,
  onClick,
  ariaLabel,
  title,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
  title: string;
}) {
  const mixSec = useSyncExternalStore(
    (onStoreChange) => onMixDurationChanged(() => onStoreChange()),
    () => getMixDuration(),
    () => 6,
  );
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const idleText = "text-[#8e8e93] hover:text-[#f5f5f7]";
  const activeText = "text-white";

  return (
    <div className="relative flex shrink-0 items-stretch">
      <div
        className={`flex h-10 items-stretch overflow-hidden rounded-full border transition-colors duration-150 ${
          active ? "border-white/30 bg-white/[0.14]" : "border-white/[0.1] bg-transparent hover:border-white/[0.18]"
        }`}
      >
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-pressed={active}
          title={title}
          className={`flex items-center gap-1.5 pe-2.5 ps-3.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20 disabled:opacity-35 ${
            active ? activeText : idleText
          } hover:bg-white/[0.04]`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 12h4l3-7 4 14 3-7h2" />
          </svg>
          Automix
        </button>

        <span aria-hidden className={`my-2 w-px shrink-0 ${active ? "bg-white/30" : "bg-white/[0.1]"}`} />

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Mix length"
          title="Mix length — how long the two songs blend"
          className={`flex items-center gap-1 pe-3 ps-2.5 text-[11px] font-semibold tabular-nums transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20 ${
            active ? activeText : idleText
          } hover:bg-white/[0.04]`}
        >
          {mixSec}s
          <svg
            viewBox="0 0 24 24"
            className={`h-2.5 w-2.5 shrink-0 transition-transform duration-150 ${menuOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {menuOpen ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div
            role="menu"
            aria-label="Mix length"
            className="absolute bottom-[calc(100%+8px)] right-0 z-50 w-36 rounded-xl border border-white/[0.1] bg-[#141418] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">
              Mix length
            </p>
            {MIX_DURATIONS.map((sec) => (
              <button
                key={sec}
                type="button"
                role="menuitemradio"
                aria-checked={mixSec === sec}
                onClick={() => {
                  setMixDuration(sec as MixDuration);
                  setMenuOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] tabular-nums transition-colors duration-150 ${
                  mixSec === sec ? "font-medium text-white" : "text-[#a1a1a6] hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {sec} seconds
                {mixSec === sec ? (
                  <svg className="h-3.5 w-3.5 shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** @deprecated Compact mode indicator — replaced by ShuffleToggleButton / AutoMixToggleButton. */
function DeckModeIndicator({
  kind,
  label,
  active,
  disabled,
  onClick,
  ariaLabel,
  title,
}: {
  kind: "mix" | "random";
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
  title: string;
}) {
  const showLabel = active ? "deck-mode-indicator--show-label" : "";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title}
      className={`deck-mode-indicator group inline-flex h-8 w-10 shrink-0 items-center justify-center gap-0 overflow-hidden rounded-lg transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/10 disabled:opacity-35 ${
        active
          ? `deck-mode-indicator--active ${showLabel}`
          : "deck-mode-indicator--idle border-transparent bg-transparent hover:bg-white/[0.03] focus-visible:bg-white/[0.03]"
      }`}
    >
      <span className="flex shrink-0 items-center gap-1">
        {kind === "mix" ? <MixModeIcon active={active} /> : <RandomModeIcon active={active} />}
        <span
          className={`deck-mode-indicator__led h-1 w-1 shrink-0 rounded-full transition-colors ${
            active ? "bg-white" : "bg-slate-600/80 group-hover:bg-slate-500"
          }`}
          aria-hidden
        />
      </span>
      <span className="deck-mode-indicator__label ml-0 max-w-0 overflow-hidden whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-[3rem] group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-[3rem] group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  );
}

function MixModeIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      className={`shrink-0 ${active ? "text-white" : "text-slate-500 group-hover:text-slate-300"}`}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M2 11.5h3.2l2.1-3.2 2.1 3.2H12L8.8 6.5 12 2H8.8L6.7 5.2 4.6 2H2l3.2 4.5L2 11.5z"
      />
    </svg>
  );
}

function RandomModeIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${active ? "text-white" : "text-slate-500 group-hover:text-slate-300"}`}
      aria-hidden
    >
      <path d="M2.5 5.5h2.8M2.5 10.5h2.8M10.7 3.5l2.8 2.8-2.8 2.8M10.7 12.5l2.8-2.8-2.8-2.8" />
      <path d="M5.3 5.5h1.2l1.5 5M9 10.5h1.2" />
    </svg>
  );
}

/** @deprecated Use DeckModeIndicator */
export const PlayerModeToggle = DeckModeIndicator;
/** @deprecated Use DeckModeIndicator */
export const PlayerModeChip = DeckModeIndicator;
