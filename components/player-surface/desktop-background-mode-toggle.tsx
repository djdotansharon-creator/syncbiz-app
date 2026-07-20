"use client";

import {
  useDesktopBackgroundMode,
  setDesktopBackgroundMode,
  type DesktopBackgroundMode,
} from "@/lib/desktop-background-mode";

const ORDER: DesktopBackgroundMode[] = ["artwork", "video", "static"];
const LABEL: Record<DesktopBackgroundMode, string> = {
  artwork: "Artwork",
  video: "Video",
  static: "Static",
};

function ModeIcon({ mode }: { mode: DesktopBackgroundMode }) {
  const common = { className: "h-3.5 w-3.5", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (mode === "artwork") {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    );
  }
  if (mode === "video") {
    return (
      <svg {...common}>
        <rect x="2" y="5" width="14" height="14" rx="2" />
        <path d="m22 8-6 4 6 4V8Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}

/**
 * Per-device desktop player background switcher (Artwork · Video · Static).
 * Cycles the localStorage-backed setting; NOT tied to MASTER/CONTROL. Mount only
 * on the desktop player.
 */
export function DesktopBackgroundModeToggle({ className }: { className?: string }) {
  const mode = useDesktopBackgroundMode();
  const cycle = () => setDesktopBackgroundMode(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]);
  return (
    <button
      type="button"
      onClick={cycle}
      title={`Player background: ${LABEL[mode]} — click to change (Artwork · Video · Static)`}
      aria-label={`Player background: ${LABEL[mode]}. Click to change.`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] font-medium text-white/70 backdrop-blur-sm transition hover:bg-black/45 hover:text-white active:scale-95 ${className ?? ""}`}
    >
      <ModeIcon mode={mode} />
      <span>{LABEL[mode]}</span>
    </button>
  );
}
