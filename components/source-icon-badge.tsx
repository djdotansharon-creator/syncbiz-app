"use client";

import type { SourceIconType } from "@/lib/player-utils";

type SourceIconBadgeProps = {
  type: SourceIconType;
  className?: string;
  size?: "sm" | "md";
};

/** YouTube icon – red play button style */
function IconYouTube({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

/** SoundCloud icon – orange cloud */
function IconSoundCloud({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 4.5c-1.5 0-2.8.5-3.9 1.2-.5.3-.9.7-1.1 1.2-.2-.1-.4-.1-.6-.1-1.1 0-2 .9-2 2v.1c-1.5.3-2.5 1.5-2.5 3 0 1.7 1.3 3 3 3h6.5c2.2 0 4-1.8 4-4 0-2.2-1.8-4-4-4-.2 0-.4 0-.6.1-.2-1.2-1.2-2.1-2.4-2.1z" />
    </svg>
  );
}

/** Local / WinAmp / computer icon */
function IconLocal({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="12" y2="17" />
    </svg>
  );
}

/** External / generic icon */
function IconExternal({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function SourceIconBadge({ type, className = "", size = "md" }: SourceIconBadgeProps) {
  const sizeClass = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const baseClass = "flex items-center justify-center rounded-lg shadow-lg bg-black/60";

  const iconProps = { className: `${sizeClass} ${type === "youtube" ? "text-[#ff0000]" : type === "soundcloud" ? "text-[#ff5500]" : "text-slate-300"}` };

  return (
    <span
      className={`${baseClass} ${sizeClass} p-1 ${className}`}
      title={type === "youtube" ? "YouTube" : type === "soundcloud" ? "SoundCloud" : type === "local" ? "Local" : "External"}
    >
      {type === "youtube" && <IconYouTube {...iconProps} />}
      {type === "soundcloud" && <IconSoundCloud {...iconProps} />}
      {type === "local" && <IconLocal {...iconProps} />}
      {type === "external" && <IconExternal {...iconProps} />}
    </span>
  );
}
