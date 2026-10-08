"use client";

import {
  useDesktopBackgroundMode,
  setDesktopBackgroundMode,
  type DesktopBackgroundMode,
} from "@/lib/desktop-background-mode";
import { useMpvVideoOutput, setMpvVideoOutputEnabled } from "@/lib/mpv-video-output";

const ORDER: DesktopBackgroundMode[] = ["artwork", "video"];
const LABEL: Record<DesktopBackgroundMode, string> = {
  artwork: "Artwork",
  video: "Video",
};

function ModeIcon({ mode }: { mode: DesktopBackgroundMode }) {
  const common = { className: "h-3 w-3", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (mode === "artwork") {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    );
  }
  // video
  return (
    <svg {...common}>
      <rect x="2" y="5" width="14" height="14" rx="2" />
      <path d="m22 8-6 4 6 4V8Z" />
    </svg>
  );
}

/**
 * P0 Video V1 — per-station switch for SYNCED video (picture + sound from the same MPV player on this station).
 * Shown only on a desktop installer that supports it. The switch applies at the next VONO start (MPV is never
 * restarted under playing audio); the badge shows "restart needed" until then.
 */
export function MpvVideoToggle({ className }: { className?: string }) {
  const s = useMpvVideoOutput();
  if (!s.supported) return null;
  const pending = s.enabled !== s.active;
  const title = s.active
    ? `Synced video (same player as the sound): ON${pending ? " — turns OFF at the next VONO start" : ""}. Click to ${s.enabled ? "turn off" : "keep on"}.`
    : `Synced video (same player as the sound): OFF${pending ? " — turns ON at the next VONO start" : ""}. Click to ${s.enabled ? "cancel" : "turn on"}.`;
  return (
    <button
      type="button"
      onClick={() => void setMpvVideoOutputEnabled(!s.enabled)}
      title={title}
      aria-label={title}
      aria-pressed={s.enabled}
      className={`relative inline-flex h-7 min-w-7 items-center justify-center rounded-lg border-2 px-1 text-[10px] font-bold tracking-tight transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50 active:scale-[0.97] ${
        s.enabled ? "border-[#0a84ff] bg-[#0a84ff]/20 text-white" : "border-white/60 bg-slate-900/95 text-white/70 hover:border-white"
      } ${className ?? ""}`}
    >
      SYNC
      {pending ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400" aria-hidden /> : null}
    </button>
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
      title={`Player background: ${LABEL[mode]} — click to switch Artwork ⇄ Video`}
      aria-label={`Player background: ${LABEL[mode]}. Click to change.`}
      // Square + white-glow, matching the player's Share/Edit action buttons.
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border-2 border-white/60 bg-slate-900/95 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.2),0_0_20px_rgba(255,255,255,0.15)] transition-all duration-200 hover:border-white hover:shadow-[0_0_0_2px_rgba(255,255,255,0.4),0_0_28px_rgba(255,255,255,0.25)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-white/50 active:scale-[0.97] ${className ?? ""}`}
    >
      <ModeIcon mode={mode} />
    </button>
  );
}
