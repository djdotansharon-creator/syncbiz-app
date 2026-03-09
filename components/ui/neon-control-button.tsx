"use client";

const neonGreenBase =
  "inline-flex items-center justify-center rounded-2xl border-2 border-[#1ed760]/60 bg-slate-900/95 text-[#1ed760] shadow-[0_0_0_1px_rgba(30,215,96,0.2),0_0_20px_rgba(30,215,96,0.15)] transition-all duration-200 hover:border-[#1ed760] hover:shadow-[0_0_0_2px_rgba(30,215,96,0.4),0_0_28px_rgba(30,215,96,0.25)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-[#1ed760]/50 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-40 disabled:pointer-events-none disabled:hover:scale-100 active:scale-[0.97]";
const neonGreenActive = "border-[#1ed760] text-[#1ed760] shadow-[0_0_0_2px_rgba(30,215,96,0.5),0_0_24px_rgba(30,215,96,0.35),0_0_40px_rgba(30,215,96,0.15)]";

const neonRedBase =
  "inline-flex items-center justify-center rounded-2xl border-2 border-[#ff4c4c]/60 bg-slate-900/95 text-[#ff4c4c] shadow-[0_0_0_1px_rgba(255,76,76,0.2),0_0_20px_rgba(255,76,76,0.15)] transition-all duration-200 hover:border-[#ff4c4c] hover:shadow-[0_0_0_2px_rgba(255,76,76,0.4),0_0_28px_rgba(255,76,76,0.25)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-[#ff4c4c]/50 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-40 disabled:pointer-events-none disabled:hover:scale-100 active:scale-[0.97]";

const neonCyanBase =
  "inline-flex items-center justify-center rounded-xl border border-cyan-400/50 bg-slate-900/90 text-cyan-400/90 shadow-[0_0_8px_rgba(34,211,238,0.12)] transition-all duration-200 hover:border-cyan-400/70 hover:text-cyan-300 hover:shadow-[0_0_12px_rgba(34,211,238,0.2)] focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]";
const neonCyanActive = "border-cyan-400/80 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.25)]";

type Size = "xs" | "sm" | "md" | "lg";
type Variant = "green" | "red" | "cyan";

const sizeMap: Record<Size, string> = {
  xs: "h-8 w-8",
  sm: "h-9 w-9",
  md: "h-11 w-11",
  lg: "h-12 w-12",
};

const iconMap: Record<Size, string> = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
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
  children: React.ReactNode;
}) {
  const base = variant === "red" ? neonRedBase : variant === "cyan" ? neonCyanBase : neonGreenBase;
  const activeCls =
    variant === "green" && active ? neonGreenActive :
    variant === "cyan" && active ? neonCyanActive : "";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`shrink-0 ${sizeMap[size]} ${base} ${activeCls}`}
    >
      {children}
    </button>
  );
}

export { iconMap as neonIconSizes };
