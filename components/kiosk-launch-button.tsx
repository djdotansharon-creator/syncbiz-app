"use client";

import { useLocale } from "@/lib/locale-context";
import { lockKiosk } from "@/lib/kiosk";

/**
 * The way from the controller to the display screen (owner 2026-10-25: "how do I get from the controller to the player? put a convenient button on the player"): a small pill in
 * the corner of the player cell (only the icon — no circle, no text (the name is its tooltip)). One click puts the display screen up over the running app (nothing underneath is touched, the music keeps playing); the
 * padlock on the display screen brings the controller back. Placed by the shell on the player's cell — the playback components themselves are not touched.
 */
export function KioskLaunchButton() {
  const { locale } = useLocale();
  const label = locale === "he" ? "מסך תצוגה" : "Display screen";
  return (
    <button type="button" className="sb-kiosk-launch" onClick={() => lockKiosk()} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4.5" width="18" height="12.5" rx="2.5" />
        <path d="M8.5 20.5h7M12 17v3.5" />
      </svg>
    </button>
  );
}
