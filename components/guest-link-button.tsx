"use client";

import { useState } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";

/** Shared amber LED pill style for guest / “My link” controls in the library rail. */
export const guestLinkLedButtonClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-600/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 transition hover:border-amber-500/60 hover:bg-amber-600/20 focus:outline-none focus:ring-2 focus:ring-amber-500/30";

type GuestLinkButtonProps = { className?: string };

/** Compact button to copy guest recommendation link. Shown when operator has active session. */
export function GuestLinkButton({ className }: GuestLinkButtonProps) {
  const ctx = useDevicePlayer();
  const [copied, setCopied] = useState(false);

  if (!ctx?.isBranchConnected || !ctx.guestLink) return null;

  async function handleCopy() {
    if (!ctx?.guestLink) return;
    try {
      await navigator.clipboard.writeText(ctx.guestLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={[guestLinkLedButtonClass, className].filter(Boolean).join(" ")}
      title="Copy guest recommendation link"
    >
      <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      <span>{copied ? "Copied!" : "Guest link"}</span>
    </button>
  );
}
