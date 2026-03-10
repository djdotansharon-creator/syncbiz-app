"use client";

import Link from "next/link";
import type { ReactNode, AnchorHTMLAttributes } from "react";

const baseStyles =
  "inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.97] select-none";

const sizeMap = {
  xs: "h-9 w-9 rounded-xl text-sm",
  sm: "h-11 w-11 rounded-xl text-base",
  md: "h-12 w-12 rounded-2xl text-lg",
  lg: "h-16 w-16 rounded-2xl text-xl",
  xl: "h-20 w-20 rounded-3xl text-2xl",
} as const;

type Size = keyof typeof sizeMap;

/* ─────────────────────────────────────────────────────────────────────────────
 * PLAY – Premium green, central hero button (Spotify + Pioneer inspired)
 * ───────────────────────────────────────────────────────────────────────────── */
export function ActionButtonPlay({
  onClick,
  disabled,
  size = "xl",
  "aria-label": ariaLabel = "Play",
  title = "Play",
  className = "",
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  size?: Size;
  "aria-label"?: string;
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`${baseStyles} ${sizeMap[size]} relative overflow-hidden
        bg-gradient-to-b from-[#1ed760] to-[#1db954]
        text-white
        shadow-[0_0_0_2px_rgba(29,185,84,0.4),0_4px_20px_rgba(29,185,84,0.5),0_0_30px_rgba(29,185,84,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]
        hover:from-[#2ee770] hover:to-[#1ed760]
        hover:shadow-[0_0_0_3px_rgba(30,215,96,0.5),0_6px_28px_rgba(30,215,96,0.6),0_0_40px_rgba(29,185,84,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]
        focus:ring-[#1ed760]/60 focus:ring-4
        disabled:shadow-[0_2px_10px_rgba(29,185,84,0.2)]
        ${className}`}
    >
      {children ?? (
        <svg className="h-[0.55em] w-[0.55em] ml-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M8 5v14l11-7L8 5z" />
        </svg>
      )}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * STOP – Bright red, tactile
 * ───────────────────────────────────────────────────────────────────────────── */
export function ActionButtonStop({
  onClick,
  disabled,
  size = "md",
  "aria-label": ariaLabel = "Stop",
  title = "Stop",
  className = "",
}: {
  onClick?: () => void;
  disabled?: boolean;
  size?: Size;
  "aria-label"?: string;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`${baseStyles} ${sizeMap[size]}
        bg-gradient-to-b from-[#ff5c5c] to-[#FF4C4C]
        text-white
        shadow-[0_3px_12px_rgba(255,76,76,0.35),0_0_0_1px_rgba(255,255,255,0.08)_inset]
        hover:from-[#ff7070] hover:to-[#ff5c5c]
        hover:shadow-[0_4px_16px_rgba(255,76,76,0.4)]
        focus:ring-[#FF4C4C]/50
        ${className}`}
    >
      <svg className="h-[0.5em] w-[0.5em]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M6 6h12v12H6z" />
      </svg>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * PAUSE – Premium gray, subtle depth
 * ───────────────────────────────────────────────────────────────────────────── */
export function ActionButtonPause({
  onClick,
  disabled,
  size = "md",
  "aria-label": ariaLabel = "Pause",
  title = "Pause",
  className = "",
}: {
  onClick?: () => void;
  disabled?: boolean;
  size?: Size;
  "aria-label"?: string;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`${baseStyles} ${sizeMap[size]}
        bg-gradient-to-b from-[#c0c0c0] to-[#B0B0B0]
        text-slate-900
        shadow-[0_3px_10px_rgba(0,0,0,0.2),0_0_0_1px_rgba(255,255,255,0.2)_inset]
        hover:from-[#d0d0d0] hover:to-[#c0c0c0]
        hover:shadow-[0_4px_14px_rgba(0,0,0,0.25)]
        focus:ring-slate-400/50
        ${className}`}
    >
      <svg className="h-[0.5em] w-[0.5em]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
      </svg>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * PREV / NEXT – Dark glass secondary (Pioneer / Rekordbox style)
 * ───────────────────────────────────────────────────────────────────────────── */
export function ActionButtonPrev({
  onClick,
  disabled,
  size = "md",
  "aria-label": ariaLabel = "Previous",
  title = "Previous",
  className = "",
}: {
  onClick?: () => void;
  disabled?: boolean;
  size?: Size;
  "aria-label"?: string;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`${baseStyles} ${sizeMap[size]}
        border border-slate-600/80
        bg-gradient-to-b from-slate-800 to-slate-900
        text-slate-200
        shadow-[0_2px_8px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.04)_inset]
        hover:border-slate-500 hover:from-slate-700 hover:to-slate-800
        hover:shadow-[0_3px_12px_rgba(0,0,0,0.35)]
        focus:ring-slate-400/40
        ${className}`}
    >
      <svg className="h-[0.55em] w-[0.55em]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
      </svg>
    </button>
  );
}

export function ActionButtonNext({
  onClick,
  disabled,
  size = "md",
  "aria-label": ariaLabel = "Next",
  title = "Next",
  className = "",
}: {
  onClick?: () => void;
  disabled?: boolean;
  size?: Size;
  "aria-label"?: string;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`${baseStyles} ${sizeMap[size]}
        border border-slate-600/80
        bg-gradient-to-b from-slate-800 to-slate-900
        text-slate-200
        shadow-[0_2px_8px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.04)_inset]
        hover:border-slate-500 hover:from-slate-700 hover:to-slate-800
        hover:shadow-[0_3px_12px_rgba(0,0,0,0.35)]
        focus:ring-slate-400/40
        ${className}`}
    >
      <svg className="h-[0.55em] w-[0.55em] ml-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M6 18V6h2v12H6zm11-6l-7 6V6l7 6z" />
      </svg>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * NEW SCHEDULE – Premium blue CTA (primary action)
 * ───────────────────────────────────────────────────────────────────────────── */
export function ActionButtonNewSchedule({
  href,
  children,
  className = "",
  ...props
}: { href: string; children: ReactNode; className?: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link
      href={href}
      className={`${baseStyles}
        min-h-[48px] rounded-xl px-6 py-3.5 text-sm font-semibold
        bg-gradient-to-b from-[#3aa0ff] to-[#1E90FF]
        text-white
        shadow-[0_0_0_2px_rgba(30,144,255,0.4),0_4px_20px_rgba(30,144,255,0.5),0_0_30px_rgba(30,144,255,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]
        hover:from-[#4dabff] hover:to-[#3aa0ff]
        hover:shadow-[0_0_0_3px_rgba(30,144,255,0.5),0_6px_28px_rgba(30,144,255,0.6),0_0_40px_rgba(30,144,255,0.25)]
        focus:ring-[#1E90FF]/60 focus:ring-4
        ${className}`}
      {...props}
    >
      {children}
    </Link>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * EDIT – Icon-only, elegant dark glass
 * variant="subtle" = Tesla-style: softer border, less glow, neutral
 * ───────────────────────────────────────────────────────────────────────────── */
export function ActionButtonEdit({
  href,
  size = "md",
  variant = "default",
  "aria-label": ariaLabel = "Edit playlist",
  title = "Edit playlist",
  className = "",
}: {
  href: string;
  size?: Size;
  variant?: "default" | "subtle";
  "aria-label"?: string;
  title?: string;
  className?: string;
}) {
  const iconSize = size === "xs" ? "h-4 w-4" : "h-5 w-5";
  const btnSize = size === "xs" ? "h-9 w-9 rounded-xl" : "h-11 w-11 rounded-xl";
  const style =
    variant === "subtle"
      ? "border border-slate-700/80 bg-slate-900/70 text-slate-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.2)] hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-200 hover:shadow-[0_0_12px_rgba(100,116,139,0.06)]"
      : "border border-slate-600/80 bg-gradient-to-b from-slate-800/90 to-slate-900/90 text-slate-300 shadow-[0_2px_6px_rgba(0,0,0,0.25)] hover:border-slate-500 hover:from-slate-700 hover:to-slate-800 hover:text-slate-100 hover:shadow-[0_0_0_1px_rgba(148,163,184,0.3),0_4px_14px_rgba(0,0,0,0.35)]";
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      title={title}
      className={`${baseStyles} ${btnSize}
        ${style}
        focus:ring-slate-400/40 focus:ring-2
        ${className}`}
    >
      <svg className={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    </Link>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * DELETE – Trash icon, red hover (destructive)
 * ───────────────────────────────────────────────────────────────────────────── */
export function ActionButtonDelete({
  onClick,
  disabled,
  size = "md",
  "aria-label": ariaLabel = "Delete playlist",
  title = "Delete playlist",
  className = "",
}: {
  onClick?: () => void;
  disabled?: boolean;
  size?: Size;
  "aria-label"?: string;
  title?: string;
  className?: string;
}) {
  const iconSize = size === "xs" ? "h-4 w-4" : "h-5 w-5";
  const btnSize = size === "xs" ? "h-9 w-9 rounded-xl" : "h-11 w-11 rounded-xl";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`${baseStyles} ${btnSize}
        border border-slate-600/80
        bg-gradient-to-b from-slate-800/90 to-slate-900/90
        text-slate-400
        shadow-[0_2px_6px_rgba(0,0,0,0.25)]
        hover:border-rose-500/60 hover:from-rose-950/40 hover:to-rose-950/60
        hover:text-rose-400 hover:shadow-[0_0_0_1px_rgba(244,63,94,0.4),0_4px_14px_rgba(244,63,94,0.25)]
        focus:ring-rose-400/40 focus:ring-2
        ${className}`}
    >
      <svg className={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * SHARE – Icon-only, dark glass
 * ───────────────────────────────────────────────────────────────────────────── */
export function ActionButtonShare({
  onClick,
  size = "md",
  "aria-label": ariaLabel = "Share",
  title = "Share",
  className = "",
}: {
  onClick?: () => void;
  size?: Size;
  "aria-label"?: string;
  title?: string;
  className?: string;
}) {
  const iconSize = size === "xs" ? "h-4 w-4" : "h-5 w-5";
  const btnSize = size === "xs" ? "h-9 w-9 rounded-xl" : "h-11 w-11 rounded-xl";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={`${baseStyles} ${btnSize}
        border border-slate-600/80
        bg-gradient-to-b from-slate-800/90 to-slate-900/90
        text-slate-400
        shadow-[0_2px_6px_rgba(0,0,0,0.25)]
        hover:border-slate-500 hover:from-slate-700 hover:to-slate-800
        hover:text-slate-200 hover:shadow-[0_0_0_1px_rgba(148,163,184,0.3),0_4px_14px_rgba(0,0,0,0.35)]
        focus:ring-slate-400/40 focus:ring-2
        ${className}`}
    >
      <svg className={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <polyline points="16 6 12 2 8 6" />
        <line x1="12" y1="2" x2="12" y2="15" />
      </svg>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * PLAY NOW – Text + icon, premium green (Schedule / Playlist cards)
 * ───────────────────────────────────────────────────────────────────────────── */
export function ActionButtonPlayNow({
  onClick,
  disabled,
  loading,
  label = "Play now",
  loadingLabel = "Sending…",
  className = "",
}: {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  loadingLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={loading ? loadingLabel : label}
      className={`${baseStyles}
        inline-flex items-center gap-3 rounded-xl px-5 py-3.5 text-sm font-semibold
        bg-gradient-to-b from-[#1ed760] to-[#1db954]
        text-white
        shadow-[0_0_0_2px_rgba(29,185,84,0.4),0_4px_20px_rgba(29,185,84,0.5),0_0_30px_rgba(29,185,84,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]
        hover:from-[#2ee770] hover:to-[#1ed760]
        hover:shadow-[0_0_0_3px_rgba(30,215,96,0.5),0_6px_28px_rgba(30,215,96,0.6),0_0_40px_rgba(29,185,84,0.25)]
        focus:ring-[#1ed760]/60 focus:ring-4
        disabled:shadow-[0_2px_10px_rgba(29,185,84,0.2)]
        ${className}`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 shadow-inner" aria-hidden>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7L8 5z" />
        </svg>
      </span>
      {loading ? loadingLabel : label}
    </button>
  );
}
