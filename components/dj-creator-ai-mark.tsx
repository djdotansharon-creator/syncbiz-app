/**
 * DJ Creator AI marks — cyan sparkle (thinking) + warm gold mark from `public/dj-creator/dj-creator-icon-B.png` (launcher).
 */

import { useId } from "react";

type Props = {
  className?: string;
};

const CYAN = "#5ee9f0";
const CYAN_SOFT = "#22d3ee";

export function DjCreatorAiSparkle({ className }: Props) {
  const uid = useId().replace(/[:]/g, "");
  const g = `djc-sparkle-${uid}`;
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={g} x1="4" y1="4" x2="16" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ecfeff" />
          <stop offset="0.5" stopColor={CYAN} />
          <stop offset="1" stopColor={CYAN_SOFT} />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${g})`}
        d="M10 1.5l.65 2 2 .65-2 .65-.65 2-.65-2-2-.65 2-.65.65-2Zm5 9l.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4.4-1.2Zm-10 0l.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4.4-1.2Z"
      />
    </svg>
  );
}

/** Drop-in asset: replace `public/dj-creator/dj-creator-icon-B.png` — square box sizing comes from `className`. */
export function DjCreatorAiWarmSpark({ className }: Props) {
  return (
    <img
      src="/dj-creator/dj-creator-icon-B.png"
      alt=""
      width={512}
      height={512}
      draggable={false}
      className={[
        "bg-transparent object-contain object-center select-none rounded-2xl ring-1 ring-white/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.55)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    />
  );
}
