"use client";

import { useState } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";

/** Rail text controls — FRAMELESS: big white text, soft bright rectangle only on hover
    (operator direction: no borders anywhere on the command rail). */
export const guestLinkLedButtonClass =
  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[14px] font-medium text-[#f5f5f7] transition-colors duration-150 hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 active:scale-[0.97]";

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
      <span>{copied ? "Copied!" : "Guest"}</span>
    </button>
  );
}
