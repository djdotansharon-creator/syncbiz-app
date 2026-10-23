"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * Volume (owner, 2026-10-14, second pass): a quiet speaker button; HOVERING it raises a thin vertical
 * capsule above it (bottom → top, no frame); drag/click on the capsule sets the volume; it tucks away
 * when the pointer leaves the column. CLICK on the speaker = mute / unmute (AudioPlayer keeps the
 * `volumeBeforeMuteRef` semantics). Same props as `PlayerVerticalVolume`, which stays in the tree.
 * Display-only: the onChange / mute wiring is unchanged.
 */
export type PlayerVolumePillProps = {
  /** 0–100 — already accounts for desktop / control-mirror branches in AudioPlayer. */
  value: number;
  onChange: (value: number) => void;
  onMuteToggle?: () => void;
  isPlaying?: boolean;
  ariaLabel?: string;
  muteLabel?: string;
};

export function PlayerVolumePill({
  value,
  onChange,
  onMuteToggle,
  ariaLabel = "Volume",
  muteLabel = "Toggle mute",
}: PlayerVolumePillProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const isMuted = v === 0;
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputId = useId();

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  /* owner, 2026-10-14: the bar tucks away the moment the pointer leaves the column (no grace — the gap
     between the speaker and the bar is inside the column, so travelling up never leaves it) */
  const scheduleClose = useCallback(() => {
    cancelClose();
    if (!draggingRef.current) setOpen(false);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  /* the bar is VERTICAL (rises from the speaker) — except in the slim "compact" player (html[data-sb-player="compact"]),
     where it opens HORIZONTALLY to the left of the speaker: the shape of the bar decides which axis the pointer reads */
  const valueFromPointer = useCallback(
    (clientX: number, clientY: number): number => {
      const el = lineRef.current;
      if (!el) return v;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0 || rect.width <= 0) return v;
      const ratio =
        rect.width > rect.height
          ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
          : 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      return Math.round(ratio * 100);
    },
    [v],
  );
  const paintFill = useCallback((next: number) => {
    const f = fillRef.current;
    if (!f) return;
    f.style.height = `${next}%`; /* immediate — before React re-renders */
    f.style.setProperty("--v", `${next}%`);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      draggingRef.current = true;
      setDragging(true);
      cancelClose();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      e.preventDefault();
      inputRef.current?.focus({ preventScroll: true });
      const next = valueFromPointer(e.clientX, e.clientY);
      paintFill(next);
      onChange(next);
    },
    [cancelClose, onChange, valueFromPointer, paintFill],
  );
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const next = valueFromPointer(e.clientX, e.clientY);
      paintFill(next);
      onChange(next);
    },
    [onChange, valueFromPointer, paintFill],
  );
  const stopDragging = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      /* released outside the column → let it tuck away */
      const root = rootRef.current;
      if (root && !root.matches(":hover")) scheduleClose();
    },
    [scheduleClose],
  );

  return (
    <div
      ref={rootRef}
      className="sb-vol"
      role="group"
      aria-label={ariaLabel}
      onPointerEnter={cancelClose}
      onPointerLeave={scheduleClose}
    >
      <span className="sb-vol-anchor relative inline-flex">
        {/* frosted glass (same recipe as the gear menu): a disc behind the speaker, a pill around the bar.
            Real elements — a backdrop-filter inside the clip-path'd bar could not see the video behind it. */}
        <span className="sb-vol-glass sb-vol-glass-disc" aria-hidden />
        <span className={`sb-vol-glass sb-vol-glass-bar${open ? " is-open" : ""}`} aria-hidden />
        <button
          type="button"
          onPointerEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onClick={onMuteToggle}
          aria-label={muteLabel}
          aria-pressed={isMuted}
          title={muteLabel}
          className={`sb-vol-btn${open ? " is-open" : ""}${isMuted ? " is-muted" : ""}`}
        >
          <SpeakerIcon level={v} />
        </button>
        <div
          ref={lineRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          className={`sb-vol-line${open ? " is-open" : ""}${dragging ? " is-dragging" : ""}`}
          role="presentation"
          aria-hidden={!open}
        >
          <div className="sb-vol-track">
            <div ref={fillRef} className="sb-vol-fill" style={{ height: `${v}%`, ["--v" as string]: `${v}%` } as React.CSSProperties} />
          </div>
        </div>
      </span>
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

/** A rounded speaker; the two arcs follow the level (one above 0, both above 50); a small × at 0. */
function SpeakerIcon({ level }: { level: number }) {
  return (
    <svg
      className="sb-vol-icon"
      data-w={level === 0 ? 0 : level > 50 ? 2 : 1}
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M4 9.6v4.8c0 .6.45 1.05 1.05 1.05h2.4l4.2 3.35c.68.54 1.45.07 1.45-.8V6c0-.87-.77-1.34-1.45-.8L7.45 8.55h-2.4C4.45 8.55 4 9 4 9.6Z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M16.2 9.3a3.9 3.9 0 0 1 0 5.4" className="sb-vol-wave" style={{ opacity: level > 0 ? 1 : 0 }} />
      <path d="M18.9 6.7a7.5 7.5 0 0 1 0 10.6" className="sb-vol-wave" style={{ opacity: level > 50 ? 1 : 0 }} />
      <path d="M16.6 9.9l4.2 4.2M20.8 9.9l-4.2 4.2" className="sb-vol-x" style={{ opacity: level === 0 ? 1 : 0 }} />
    </svg>
  );
}
