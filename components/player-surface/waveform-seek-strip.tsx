"use client";

import { useMemo } from "react";

/**
 * WaveformSeekStrip — pro DJ-style seek strip.
 *
 * The bars are DETERMINISTIC per track: heights derive from a hash of the
 * track seed (id/url), so a track always shows the same "waveform" without
 * decoding audio (remote YouTube/stream playback has no local PCM to read).
 * If real peaks are ever computed server-side (yt-dlp/ffprobe) they can be
 * passed via `peaks` and the strip renders them instead.
 *
 * Layers: grey bars (full) → accent bars clipped to played % → soft buffered tint.
 * Pointer events pass through — the parent timeline owns seeking.
 */

function seededBars(seed: string, count: number): number[] {
  /* FNV-1a hash → xorshift stream; blended with a slow sine envelope so the
     strip reads like a musical waveform rather than white noise. */
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h |= 0;
    const r = ((h >>> 0) % 1000) / 1000;
    const envelope = 0.5 + 0.5 * Math.sin((i / count) * Math.PI * 3.2 + (h % 7));
    out.push(0.22 + 0.78 * (0.55 * r + 0.45 * envelope));
  }
  return out;
}

function Bars({ heights, barClass }: { heights: number[]; barClass: string }) {
  return (
    <div className="flex h-full w-full items-center gap-px">
      {heights.map((v, i) => (
        <span
          key={i}
          className={`min-w-0 flex-1 ${barClass}`}
          style={{ height: `${Math.round(v * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function WaveformSeekStrip({
  seed,
  progressPercent,
  bufferedPercent = 0,
  peaks,
  barCount = 200,
  className = "",
}: {
  seed: string;
  progressPercent: number;
  bufferedPercent?: number;
  /** Optional real peak data (0..1) — overrides the deterministic bars. */
  peaks?: number[] | null;
  barCount?: number;
  className?: string;
}) {
  const heights = useMemo(
    () => (peaks && peaks.length > 8 ? peaks : seededBars(seed || "syncbiz", barCount)),
    [peaks, seed, barCount],
  );
  const played = Math.max(0, Math.min(100, progressPercent));
  const buffered = Math.max(played, Math.min(100, bufferedPercent));

  return (
    <div className={`pointer-events-none ${className}`} aria-hidden>
      {/* Base bars */}
      <div className="absolute inset-0">
        <Bars heights={heights} barClass="bg-white/[0.16]" />
      </div>
      {/* Buffered tint */}
      {buffered > played ? (
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - buffered}% 0 0)` }}>
          <Bars heights={heights} barClass="bg-white/[0.24]" />
        </div>
      ) : null}
      {/* Played — accent */}
      <div
        className="absolute inset-0 transition-[clip-path] duration-100"
        style={{ clipPath: `inset(0 ${100 - played}% 0 0)` }}
      >
        <Bars heights={heights} barClass="bg-[color:var(--lib-accent,#0a84ff)]" />
      </div>
    </div>
  );
}
