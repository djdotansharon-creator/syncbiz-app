import type { ReactElement } from "react";

/** A clean "i in a circle": a thin ring, a short stem and a dot — drawn as an icon (no text glyph), same weight as the other line icons. */
export function InfoIcon({ size = 20 }: { size?: number }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 11.1v5.3" />
      <circle cx="12" cy="7.85" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
