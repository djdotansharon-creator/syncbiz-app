"use client";

import { useLocale } from "@/lib/locale-context";
import { lockKiosk } from "@/lib/kiosk";

/** Gear menu → "Display screen": puts the locked display screen up on this device (owner 2026-10-25). The controller keeps running underneath. */
export function KioskLockMenuRow({ onDone }: { onDone?: () => void }) {
  const { locale } = useLocale();
  const he = locale === "he";
  return (
    <button
      type="button"
      className="sb-kiosk-menu-row"
      onClick={() => {
        onDone?.();
        lockKiosk();
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
        <path d="M7 10V8a5 5 0 0 1 10 0v2h.5A2.5 2.5 0 0 1 20 12.5v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10H7Zm2 0h6V8a3 3 0 0 0-6 0v2Z" />
      </svg>
      <span>{he ? "מסך תצוגה (נעילה)" : "Display screen (lock)"}</span>
    </button>
  );
}
