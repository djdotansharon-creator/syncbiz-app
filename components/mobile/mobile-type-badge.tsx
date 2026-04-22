"use client";

import type { UnifiedSource } from "@/lib/source-types";

type Props = {
  source: Pick<UnifiedSource, "origin" | "type" | "playlist">;
  /** Render as a thin pill (list rows). Larger variant for cards. */
  size?: "sm" | "md";
  className?: string;
};

/**
 * Small badge that makes "playlist vs single track/URL" immediately obvious in
 * mobile lists and cards. Derives its label + color from `UnifiedSource.origin`
 * and `.type` (provider).
 *
 * Not localized yet — all other mobile strings in this area are English.
 */
export function MobileTypeBadge({ source, size = "sm", className = "" }: Props) {
  const meta = describe(source);
  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border font-medium uppercase tracking-wide ${pad} ${meta.tone} ${className}`}
    >
      {meta.label}
    </span>
  );
}

function describe(source: Pick<UnifiedSource, "origin" | "type" | "playlist">): {
  label: string;
  tone: string;
} {
  if (source.origin === "playlist") {
    return {
      label: "Playlist",
      // Indigo family — reserved for multi-track containers.
      tone: "border-indigo-400/30 bg-indigo-500/15 text-indigo-200",
    };
  }
  if (source.origin === "radio") {
    return {
      label: "Radio",
      tone: "border-rose-400/30 bg-rose-500/15 text-rose-200",
    };
  }
  // Single URL / track — color by provider so YouTube/SoundCloud are easy to scan.
  const t = (source.type || "").toLowerCase();
  if (t.includes("youtube")) {
    return { label: "YouTube", tone: "border-red-400/30 bg-red-500/15 text-red-200" };
  }
  if (t.includes("soundcloud")) {
    return { label: "SoundCloud", tone: "border-orange-400/30 bg-orange-500/15 text-orange-200" };
  }
  if (t.includes("mixcloud")) {
    return { label: "Mixcloud", tone: "border-teal-400/30 bg-teal-500/15 text-teal-200" };
  }
  if (t.includes("vimeo")) {
    return { label: "Vimeo", tone: "border-cyan-400/30 bg-cyan-500/15 text-cyan-200" };
  }
  return { label: "Track", tone: "border-slate-500/40 bg-slate-700/40 text-slate-200" };
}
