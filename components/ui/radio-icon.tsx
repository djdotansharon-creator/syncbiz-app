"use client";

type RadioIconVariant = "classic" | "broadcast" | "vintage" | "waves" | "tower";

/** Classic radio – solid body, antenna, speaker + dial (current default) */
function IconClassic({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.24 6.15C2.51 6.43 2 7.17 2 8v12c0 1.1.89 2 2 2h16c1.11 0 2-.9 2-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34L15.88 1 3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z" />
    </svg>
  );
}

/** Broadcast tower */
function IconBroadcast({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 3l4 4" />
      <path d="M19 3l-4 4" />
      <path d="M12 22v-8" />
      <path d="M5 7l4 4" />
      <path d="M19 7l-4 4" />
      <path d="M12 14v4" />
      <circle cx="12" cy="18" r="2" />
      <path d="M5 7a7 7 0 0 1 14 0" strokeOpacity="0.5" />
    </svg>
  );
}

/** Vintage radio – speaker + dial */
function IconVintage({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9v1.5M12 13.5v1.5M10.5 12h-1.5M14.5 12h1.5" strokeWidth="1.5" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** Sound waves – minimalist waveform */
function IconWaves({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12v4M8 10v8M12 8v8M16 10v8M20 12v4" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Radio tower – simple antenna */
function IconTower({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2v6" />
      <path d="M12 18v4" />
      <path d="M8 8l4 4 4-4" />
      <path d="M6 12h12" />
      <path d="M12 14v4" />
      <circle cx="12" cy="18" r="2" />
      <path d="M4 10a8 8 0 0 1 16 0" strokeOpacity="0.5" />
    </svg>
  );
}

const variants: Record<RadioIconVariant, typeof IconBroadcast> = {
  classic: IconClassic,
  broadcast: IconBroadcast,
  vintage: IconVintage,
  waves: IconWaves,
  tower: IconTower,
};

/** Radio icon – use variant prop to switch. Options: classic | broadcast | vintage | waves | tower */
export function RadioIcon({ className = "h-4 w-4", variant = "classic" }: { className?: string; variant?: RadioIconVariant }) {
  const Icon = variants[variant];
  return <Icon className={className} />;
}

/** Export variants for documentation/selection */
export { IconClassic, IconBroadcast, IconVintage, IconWaves, IconTower };
