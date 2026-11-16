"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { StationPlaybackState } from "@/lib/remote-control/types";
import { computeLivePosition } from "@/lib/remote-control/live-position";
import type { FleetBranch } from "@/lib/mobile-fleet";

/** m:ss (h:mm:ss over an hour) — "–:––" while the length is not known */
export function fmtTime(sec: number | null | undefined): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "–:––";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** a stable colour pair from a name — the tile a branch / playlist wears when it has no picture */
function tileFor(name: string): { background: string; initials: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 38) % 360;
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "").slice(0, 2)).toUpperCase();
  return { background: `linear-gradient(135deg, hsl(${a} 42% 34%), hsl(${b} 48% 20%))`, initials };
}

/** A square / round picture: the image fades in when it has loaded; until then (or without one) a tile coloured from the name. */
export function VmCover({
  src,
  name,
  size,
  radius = 14,
  className = "",
  glyph,
  style,
  playing,
}: {
  src?: string | null;
  name: string;
  /** px; omit when the box is sized by CSS (the Now Playing art) */
  size?: number;
  radius?: number | string;
  className?: string;
  /** shown on the tile instead of the initials (an icon) */
  glyph?: React.ReactNode;
  style?: CSSProperties;
  /** the Now Playing art breathes: full size while it plays, a little smaller while paused */
  playing?: boolean;
}) {
  // the load state belongs to the picture it was read for (a new `src` starts over without an effect)
  const [st, setSt] = useState<{ src: string | null | undefined; ok: boolean; bad: boolean }>({ src, ok: false, bad: false });
  const ok = st.src === src && st.ok;
  const bad = st.src === src && st.bad;
  const tile = tileFor(name || "·");
  return (
    <div
      className={`vm-cover ${className}`}
      data-playing={playing === undefined ? undefined : String(playing)}
      style={{
        ...(size ? { width: size, height: size, fontSize: Math.round(size * 0.34) } : {}),
        borderRadius: radius,
        ["--vm-tile" as string]: tile.background,
        ...style,
      }}
    >
      {glyph ?? tile.initials}
      {src && !bad ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" data-ok={ok ? "" : undefined} onLoad={() => setSt({ src, ok: true, bad: false })} onError={() => setSt({ src, ok: false, bad: true })} />
      ) : null}
    </div>
  );
}

export function VmEq({ on = true }: { on?: boolean }) {
  return (
    <span className="vm-eq" data-off={on ? undefined : ""} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/** A line that scrolls sideways only when it does not fit. */
export function VmMarquee({ text, className = "" }: { text: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [dx, setDx] = useState<number | null>(null);
  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!b || !i) return;
    const id = requestAnimationFrame(() => {
      const over = i.scrollWidth - b.clientWidth;
      setDx(over > 4 ? -(i.scrollWidth - b.clientWidth + 28) : null);
    });
    return () => cancelAnimationFrame(id);
  }, [text]);
  return (
    <div ref={box} className={`vm-mq ${className}`} data-run={dx !== null ? "" : undefined} style={dx !== null ? ({ ["--vm-mq-dx" as string]: `${dx}px` } as CSSProperties) : undefined}>
      <span ref={inner}>{text}</span>
    </div>
  );
}

/**
 * The live position of what a branch is playing: the station reports it about once a second, so between reports it advances locally from the
 * station's own capture time (the same `computeLivePosition` the desktop and the old phone use — one implementation, they never disagree).
 */
export function useLivePosition(state: StationPlaybackState | null | undefined): number {
  const [, force] = useState(0);
  const playing = state?.status === "playing";
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => force((n) => (n + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, [playing]);
  const v = computeLivePosition(state ? { position: state.position, positionAt: state.positionAt, duration: state.duration, status: state.status } : null, null);
  return Number.isFinite(v) ? v : 0;
}

/**
 * A slider that follows the finger exactly, keeps showing what the finger set until the branch confirms it (never snaps back and forward),
 * and sends the value while dragging (`onLive`, throttled) and once more on release (`onCommit`).
 * `value` is the truth from the branch (0..max); `hold` = how long a released value is trusted over `value` (ms).
 */
export function VmSlider({
  value,
  max,
  onLive,
  onCommit,
  label,
  disabled,
  glide,
  hold = 1400,
}: {
  value: number;
  max: number;
  onLive?: (v: number) => void;
  onCommit: (v: number) => void;
  label: string;
  disabled?: boolean;
  /** animate the fill between updates (the progress bar) */
  glide?: boolean;
  hold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [held, setHeld] = useState<{ v: number; until: number } | null>(null);
  const lastLive = useRef(0);
  const dragRef = useRef<number | null>(null);

  const at = useCallback(
    (clientX: number) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r || r.width <= 0) return 0;
      return Math.max(0, Math.min(max, ((clientX - r.left) / r.width) * max));
    },
    [max],
  );

  // a released value is trusted over the branch's until the branch has caught up with it — or until it has waited long enough
  useEffect(() => {
    if (!held) return;
    const t = setTimeout(() => setHeld(null), Math.max(0, held.until - Date.now()));
    return () => clearTimeout(t);
  }, [held]);
  const holding = !!held && Math.abs(value - held.v) > Math.max(1.5, max * 0.02);

  const shown = drag ?? (holding && held ? held.v : value);
  const pct = max > 0 ? Math.max(0, Math.min(100, (shown / max) * 100)) : 0;

  return (
    <div
      ref={ref}
      className="vm-slider"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      data-active={drag !== null ? "" : undefined}
      data-glide={glide && drag === null && !holding ? "" : undefined}
      data-off={disabled ? "" : undefined}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = at(e.clientX);
        dragRef.current = v;
        setDrag(v);
        onLive?.(v);
        lastLive.current = Date.now();
      }}
      onPointerMove={(e) => {
        if (dragRef.current === null) return;
        const v = at(e.clientX);
        dragRef.current = v;
        setDrag(v);
        if (onLive && Date.now() - lastLive.current > 110) {
          lastLive.current = Date.now();
          onLive(v);
        }
      }}
      onPointerUp={(e) => {
        if (dragRef.current === null) return;
        const v = at(e.clientX);
        dragRef.current = null;
        setDrag(null);
        setHeld({ v, until: Date.now() + hold });
        onCommit(v);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setDrag(null);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        const step = Math.max(1, max / 20);
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onCommit(Math.min(max, value + step));
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onCommit(Math.max(0, value - step));
      }}
      tabIndex={disabled ? -1 : 0}
    >
      <div className="vm-slider-track">
        <div className="vm-slider-fill" style={{ ["--p" as string]: `${pct}%` } as CSSProperties} />
      </div>
    </div>
  );
}

/** the one-line status of a branch for the lists: what it plays, or why it does not */
export function branchLine(b: FleetBranch, tr: (s: string) => string): { text: string; live: boolean } {
  switch (b.status) {
    case "playing": {
      const s = b.state;
      const text = s?.currentTrack?.title || s?.currentSource?.title || tr("Playing");
      return { text, live: true };
    }
    case "idle": {
      const s = b.state;
      return { text: s?.status === "paused" ? tr("Paused") : tr("Nothing playing"), live: false };
    }
    case "offline":
      return { text: tr("Offline"), live: false };
    case "install":
      return { text: tr("Needs a player installed"), live: false };
    default:
      return { text: tr("Connecting…"), live: false };
  }
}
