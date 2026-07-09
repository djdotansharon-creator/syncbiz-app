"use client";

/*
 * Clean control button — SyncBiz modern design language.
 * Quiet surfaces, hairline borders, no glow. The variant color appears only
 * in the icon tint (and as a soft tint fill when active), so controls stay
 * calm at rest and read clearly when engaged.
 * Public API is unchanged (variants/sizes/active/libraryDeck props).
 */

const baseShape =
  "inline-flex items-center justify-center rounded-xl border transition-[border-color,background-color,color,transform,opacity] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.96]";

const quietSurface =
  "border-white/[0.08] bg-white/[0.05] hover:border-white/[0.16] hover:bg-white/[0.08]";

const greenBase = `${baseShape} ${quietSurface} text-[#30d158]`;
const greenActive = "border-[#30d158]/40 bg-[#30d158]/15 text-[#30d158]";

const redBase = `${baseShape} ${quietSurface} text-[#ff453a]`;

const cyanBase = `${baseShape} ${quietSurface} text-[#0a84ff]`;
const cyanActive = "border-[#0a84ff]/40 bg-[#0a84ff]/15 text-[#0a84ff]";

const whiteBase = `${baseShape} ${quietSurface} text-slate-100`;
const whiteActive = "border-white/30 bg-white/15 text-white";

/** Inactive: restrained dark frame, subtle border, restrained icon */
const subtleBase = `${baseShape} border-white/[0.06] bg-white/[0.03] text-slate-500 hover:text-slate-300`;
/** Active: quiet accent tint, matches top nav (Sources/Radio) */
const subtleActive = "border-[#0a84ff]/35 bg-[#0a84ff]/15 text-[#7db8ff]";

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
  /** When true, `/sources` deck applies premium library rail geometry (rounded-xl, token borders) via CSS. */
  libraryDeck = false,
  /** Larger primary play control on deck: keeps rounded-2xl hero geometry. */
  libraryDeckHero = false,
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
  libraryDeck?: boolean;
  libraryDeckHero?: boolean;
}) {
  const base =
    variant === "red" ? redBase :
    variant === "cyan" ? cyanBase :
    variant === "white" ? whiteBase :
    variant === "subtle" ? subtleBase : greenBase;
  const activeCls =
    libraryDeck && active
      ? "library-deck-neon-btn-active"
      : variant === "green" && active
        ? greenActive
        : variant === "cyan" && active
          ? cyanActive
          : variant === "white" && active
            ? whiteActive
            : variant === "subtle" && active
              ? subtleActive
              : "";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`shrink-0 ${sizeMap[size]} ${base} ${activeCls} ${
        libraryDeck && variant !== "red"
          ? `library-deck-neon-btn${libraryDeckHero ? " library-deck-neon-btn--hero" : ""}`
          : ""
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export { iconMap as neonIconSizes };
