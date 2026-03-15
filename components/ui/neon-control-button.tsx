"use client";

const neonGreenBase =
  "inline-flex items-center justify-center rounded-2xl border-2 border-[#1ed760]/60 bg-slate-900/95 text-[#1ed760] shadow-[0_0_0_1px_rgba(30,215,96,0.2),0_0_20px_rgba(30,215,96,0.15)] transition-all duration-200 hover:border-[#1ed760] hover:shadow-[0_0_0_2px_rgba(30,215,96,0.4),0_0_28px_rgba(30,215,96,0.25)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-[#1ed760]/50 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-40 disabled:pointer-events-none disabled:hover:scale-100 active:scale-[0.97]";
const neonGreenActive = "border-[#1ed760] text-[#1ed760] shadow-[0_0_0_2px_rgba(30,215,96,0.5),0_0_24px_rgba(30,215,96,0.35),0_0_40px_rgba(30,215,96,0.15)]";

const neonRedBase =
  "inline-flex items-center justify-center rounded-lg border-2 border-[#ff4c4c]/60 bg-slate-900/95 text-[#ff4c4c] shadow-[0_0_0_1px_rgba(255,76,76,0.2),0_0_20px_rgba(255,76,76,0.15)] transition-all duration-200 hover:border-[#ff4c4c] hover:shadow-[0_0_0_2px_rgba(255,76,76,0.4),0_0_28px_rgba(255,76,76,0.25)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-[#ff4c4c]/50 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-40 disabled:pointer-events-none disabled:hover:scale-100 active:scale-[0.97]";

const neonCyanBase =
  "inline-flex items-center justify-center rounded-lg border-2 border-cyan-400/60 bg-slate-900/95 text-cyan-400 shadow-[0_0_0_1px_rgba(34,211,238,0.2),0_0_20px_rgba(34,211,238,0.15)] transition-all duration-200 hover:border-cyan-400 hover:shadow-[0_0_0_2px_rgba(34,211,238,0.4),0_0_28px_rgba(34,211,238,0.25)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-cyan-400/50 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-40 disabled:pointer-events-none disabled:hover:scale-100 active:scale-[0.97]";
const neonCyanActive = "border-cyan-400 text-cyan-400 shadow-[0_0_0_2px_rgba(34,211,238,0.5),0_0_24px_rgba(34,211,238,0.35),0_0_40px_rgba(34,211,238,0.15)]";

const neonWhiteBase =
  "inline-flex items-center justify-center rounded-lg border-2 border-white/60 bg-slate-900/95 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.2),0_0_20px_rgba(255,255,255,0.15)] transition-all duration-200 hover:border-white hover:shadow-[0_0_0_2px_rgba(255,255,255,0.4),0_0_28px_rgba(255,255,255,0.25)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-40 disabled:pointer-events-none disabled:hover:scale-100 active:scale-[0.97]";
const neonWhiteActive = "border-white text-white shadow-[0_0_0_2px_rgba(255,255,255,0.5),0_0_24px_rgba(255,255,255,0.35),0_0_40px_rgba(255,255,255,0.15)]";

/** Inactive: restrained dark frame, subtle border, restrained icon */
const subtleBase =
  "inline-flex items-center justify-center rounded-[10px] border border-slate-600/20 bg-[rgba(10,15,25,0.8)] text-slate-500 transition-all duration-200 hover:border-slate-500/30 hover:text-slate-400 hover:bg-slate-800/40 focus:outline-none focus:ring-1 focus:ring-slate-500/30 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]";
/** Active: blue illuminated border + icon, matches top nav (Sources/Radio) */
const subtleActive =
  "border-sky-500/60 bg-sky-500/20 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.25)]";

type Size = "2xs" | "xs" | "sm" | "md" | "lg" | "xl";
type Variant = "green" | "red" | "cyan" | "white" | "subtle";

const sizeMap: Record<Size, string> = {
  "2xs": "h-7 w-7",
  xs: "h-8 w-8",
  sm: "h-9 w-9",
  md: "h-11 w-11",
  lg: "h-12 w-12",
  xl: "h-14 w-14 sm:h-16 sm:w-16",
};

const iconMap: Record<Size, string> = {
  "2xs": "h-3 w-3",
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
  xl: "h-7 w-7 sm:h-8 sm:w-8",
};

export function NeonControlButton({
  onClick,
  disabled,
  active,
  size = "md",
  variant = "green",
  type = "button",
  "aria-label": ariaLabel,
  title,
  className,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  size?: Size;
  variant?: Variant;
  type?: "button" | "submit" | "reset";
  "aria-label"?: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const base =
    variant === "red" ? neonRedBase :
    variant === "cyan" ? neonCyanBase :
    variant === "white" ? neonWhiteBase :
    variant === "subtle" ? subtleBase : neonGreenBase;
  const activeCls =
    variant === "green" && active ? neonGreenActive :
    variant === "cyan" && active ? neonCyanActive :
    variant === "white" && active ? neonWhiteActive :
    variant === "subtle" && active ? subtleActive : "";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`shrink-0 ${sizeMap[size]} ${base} ${activeCls} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export { iconMap as neonIconSizes };
