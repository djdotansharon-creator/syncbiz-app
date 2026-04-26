"use client";

import { useCallback, useId, useRef } from "react";

/**
 * Vertical mixer-strip VOLUME module — slim channel rendering for the
 * right-aside slot of `PlayerUnitSurface`.
 *
 * Layout: tick scale (left) · fader hit zone (center) · 2-column L / R LED
 * meter (right) · enlarged mute button + visual `L · R` channel label (bottom).
 *
 * Design notes per channel-strip reference
 * ---------------------------------------
 * - The fader interaction is unchanged (custom pointer capture +
 *   visually-hidden a11y `<input type="range">`) — that pass shipped 1:1
 *   cursor tracking and the user signed off on it; we don't touch logic here.
 * - LEDs are now rendered as two compact L / R columns of 16 thinner segments
 *   each (was a single 12-segment column with min-height 3px, which read as
 *   "clunky"). Both columns mirror the same value — no real stereo metering
 *   yet, just a stereo-style visual cue.
 * - A tick scale (100 / 75 / 50 / 25 / 0) returns on the left, with short
 *   tick lines pointing at the track. It's the part the reference image
 *   highlighted as "professional".
 * - Mute is a dedicated icon button (was a tiny 20×20 button with no border).
 *   It's now 28×28 with a visible slate border so it reads as a real button.
 *   The `L · R` label below it stays decorative — it's still a `<span>`, NOT
 *   a control, matching real channel-strip convention.
 *
 * Architecture (unchanged from the previous pass)
 * -----------------------------------------------
 * The earlier visible `<input type="range" orient="vertical">` had a known
 * smoothness bug: the native vertical thumb's value range is *inset* by half
 * the thumb's height at the top and bottom of the track — the thumb's center
 * never reaches the visual track ends — but our painted handle uses
 * `top: ${100-v}%` which DOES reach the ends. So during drag the painted
 * handle drifted ~6 px from the cursor and click-to-jump landed a few pixels
 * off where the user clicked.
 *
 * Fix: own the pointer interaction directly with `setPointerCapture` and
 * compute the value from cursor Y relative to the *exact* track inset
 * (`insetRef`). Painted handle, fill, and cursor all derive from the same
 * coordinate system → handle tracks cursor 1:1.
 *
 * Accessibility is preserved by keeping a real `<input type="range">` mounted
 * but visually hidden via the `vol-deck-input-a11y` class. It receives focus
 * on Tab (and on pointerdown so the keyboard works after a click), and
 * Arrow / PageUp / PageDown / Home / End all flow through its onChange.
 *
 * LED zones (bottom-up, both columns):
 *   - segments 1..10 (ratio ≤ 0.625)          green
 *   - segments 11..15 (0.625 < ratio < 0.95)  amber
 *   - segment  16    (ratio ≥ 0.95)           red (subtle peak)
 */

// 16 thin segments per column reads as a finer / more delicate meter than the
// 12-segment chunkier version. With min-height: 2px each (set in CSS), 16
// segments + 15 gaps × 1px ≈ 47 px floor — comfortably inside the channel
// strip on every shipping deck-row size.
const SEGMENTS = 16;

const TICK_LABELS = [100, 75, 50, 25, 0] as const;

export type PlayerVerticalVolumeProps = {
  /** 0–100 — already accounts for desktop / control-mirror branches in AudioPlayer. */
  value: number;
  onChange: (value: number) => void;
  /** Mute / unmute toggle. AudioPlayer owns the `volumeBeforeMuteRef` semantics. */
  onMuteToggle?: () => void;
  /** Localized aria label for the slider input itself. */
  ariaLabel?: string;
  /** Localized label for the mute toggle (used as both aria-label and title). */
  muteLabel?: string;
};

export function PlayerVerticalVolume({
  value,
  onChange,
  onMuteToggle,
  ariaLabel = "Volume",
  muteLabel = "Toggle mute",
}: PlayerVerticalVolumeProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const litCount = Math.round((v / 100) * SEGMENTS);
  const isMuted = v === 0;

  const insetRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const inputId = useId();

  const valueFromClientY = useCallback((clientY: number): number => {
    const el = insetRef.current;
    if (!el) return v;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return v;
    const y = clientY - rect.top;
    const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
    return Math.round(ratio * 100);
  }, [v]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Left click / primary touch only — let right-click and middle-click bubble.
      if (e.button !== 0) return;
      draggingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* setPointerCapture can fail in some test envs; the move handler is on
         * the same element so dragging continues even without capture. */
      }
      e.preventDefault();
      // Move keyboard focus to the hidden a11y input so subsequent
      // ArrowUp/Down/PageUp/Down/Home/End keep editing the same value.
      inputRef.current?.focus({ preventScroll: true });
      onChange(valueFromClientY(e.clientY));
    },
    [onChange, valueFromClientY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      onChange(valueFromClientY(e.clientY));
    },
    [onChange, valueFromClientY],
  );

  const stopDragging = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }, []);

  return (
    /*
     * Sizing rules:
     * - `w-[104px]`: ~4 px wider than the previous 92 px to fit the tick scale
     *   on the left + 2 LED columns on the right while keeping the strip
     *   inside the user's 88–100 px target band-of-tolerance. Still narrow
     *   enough to read as a slim mixer channel, not a console panel.
     * - `h-full`: track the parent flex line height set by `PlayerUnitSurface`
     *   right-aside slot — same rule as the previous pass.
     * - `overflow-hidden`: hard clip if a future deck row shrinks below the
     *   strip's natural content height.
     * - `px-1.5 py-1.5`: tightened so the inner three-column strip can keep
     *   readable widths even at the lower bound of the deck-row width.
     */
    <div
      className="vol-deck-shell flex h-full w-[104px] flex-col items-stretch overflow-hidden rounded-lg border border-slate-700/55 bg-slate-950/85 px-1.5 py-1.5"
      role="group"
      aria-label={ariaLabel}
    >
      {/* Compact value badge at top — kept centered over the channel strip
       * so it reads as the strip's current value rather than as a header. */}
      <div className="flex items-baseline justify-center pb-1">
        <span className="vol-deck-readout font-mono text-[15px] font-bold tabular-nums leading-none">
          {String(v).padStart(2, "0")}
        </span>
      </div>

      {/* Channel strip: tick scale (left) | fader hit zone (center, flex-1) | 2-col L/R LED meter (right). */}
      <div className="flex flex-1 min-h-0 items-stretch gap-1">
        {/* Tick scale — five labels at 100 / 75 / 50 / 25 / 0 with short
         * tick lines pointing at the track. Padded to inset-y-[3px] so the
         * top label "100" lines up vertically with the slider's 100 endpoint
         * (handle center) and "0" with the slider's 0 endpoint. */}
        <div
          className="flex w-6 shrink-0 flex-col justify-between py-[3px]"
          aria-hidden
        >
          {TICK_LABELS.map((tick) => (
            <div
              key={tick}
              className="flex items-center justify-end gap-[2px] leading-none"
            >
              <span className="font-mono text-[7px] font-semibold text-slate-400/70 tabular-nums">
                {tick}
              </span>
              <span className="block h-px w-1 bg-slate-500/55" />
            </div>
          ))}
        </div>

        {/* Slider hit zone — owns ALL pointer interaction. The painted handle,
         * fill, and track all live inside `insetRef` so the cursor-to-value
         * mapping is exact (no native-input thumb inset drift). The zone
         * flex-grows so the user has a generous target. */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          className="vol-deck-track relative flex flex-1 cursor-pointer items-stretch select-none touch-none"
          role="presentation"
        >
          <div ref={insetRef} className="absolute inset-y-[3px] inset-x-0">
            <div
              className="absolute inset-y-0 left-1/2 w-[5px] -translate-x-1/2 rounded-full bg-slate-900/95 shadow-[inset_0_0_2px_rgba(0,0,0,0.8)]"
              aria-hidden
            />
            <div
              className="absolute bottom-0 left-1/2 w-[5px] -translate-x-1/2 rounded-full bg-gradient-to-t from-cyan-500/85 via-cyan-400/90 to-cyan-300"
              style={{ height: `${v}%` }}
              aria-hidden
            />
            <div
              className="vol-deck-handle absolute left-1/2 z-10 h-[10px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-[3px]"
              style={{ top: `${100 - v}%` }}
              aria-hidden
            />
          </div>
        </div>

        {/* L / R LED meter — two compact mirrored columns of 16 thin segments
         * each. Visual only; both columns reflect the same value, since real
         * stereo metering would require taps from MPV that aren't wired yet.
         * `gap-[1px]` between columns keeps the look tight and finely-divided. */}
        <div className="flex shrink-0 items-stretch gap-[1px]" aria-hidden>
          {(["L", "R"] as const).map((channel) => (
            <div
              key={channel}
              className="flex w-[4px] flex-col-reverse gap-[1px] py-[3px]"
            >
              {Array.from({ length: SEGMENTS }).map((_, i) => {
                const seg = i + 1;
                const on = seg <= litCount;
                const ratio = seg / SEGMENTS;
                // Green ≤ 0.625 (10/16), amber 11..15, red top segment only.
                const isHot = ratio >= 0.95;
                const isWarm = !isHot && ratio > 0.625;
                return (
                  <span
                    key={i}
                    className={`vol-deck-led${on ? " is-on" : ""}${isWarm ? " is-warm" : ""}${isHot ? " is-hot" : ""}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom block: enlarged mute icon button (with visible frame) +
       * visual-only L · R channel label. The label is a `<span aria-hidden>`,
       * NOT a button — channel-strip convention is that L · R indicates the
       * stereo grouping, not a control. */}
      <div className="mt-1 flex flex-col items-center gap-0.5">
        <button
          type="button"
          onClick={onMuteToggle}
          aria-label={muteLabel}
          aria-pressed={isMuted}
          title={muteLabel}
          className={`vol-deck-mute-btn flex h-7 w-7 items-center justify-center rounded-md border transition-colors focus:outline-none focus:ring-1 focus:ring-cyan-400/55 ${
            isMuted
              ? "border-rose-400/55 bg-rose-500/10 text-rose-200 hover:border-rose-300 hover:bg-rose-500/20 hover:text-rose-100"
              : "border-slate-600/65 bg-slate-900/70 text-slate-300 hover:border-cyan-400/55 hover:bg-slate-800/85 hover:text-cyan-100"
          }`}
        >
          <MuteIcon muted={isMuted} />
        </button>
        <span
          className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-500/80"
          aria-hidden
        >
          L &middot; R
        </span>
      </div>

      {/* Visually-hidden accessibility input. Keyboard (Tab focus, Arrow,
       * PageUp/Down, Home/End) and screen readers operate on this element.
       * The shell's `focus-within` ring tells sighted keyboard users where
       * they are when this hidden input is focused. */}
      <input
        ref={inputRef}
        id={inputId}
        type="range"
        min={0}
        max={100}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        className="vol-deck-input-a11y"
      />
    </div>
  );
}

/**
 * Tiny inline speaker icon. `muted` swaps the right-side waves for an X mark
 * so the state is visible at a glance without relying on color alone. Sized
 * to 14×14 to match the enlarged mute button — small enough to feel light,
 * large enough to read at a glance.
 */
function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M3.5 6h2L8 4v8L5.5 10h-2A.5.5 0 0 1 3 9.5v-3A.5.5 0 0 1 3.5 6Z"
        fill="currentColor"
        stroke="none"
      />
      {muted ? (
        <>
          <path d="M10.5 6.5l3 3" />
          <path d="M13.5 6.5l-3 3" />
        </>
      ) : (
        <>
          <path d="M10.5 6.2c.9 1.1.9 2.5 0 3.6" />
          <path d="M12.4 5c1.6 1.8 1.6 4.2 0 6" />
        </>
      )}
    </svg>
  );
}
