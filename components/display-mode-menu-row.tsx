"use client";

import type { CSSProperties } from "react";
import { useLocale } from "@/lib/locale-context";
import { useLibraryTheme } from "@/lib/library-theme-context";
import {
  libraryThemeForMode,
  useDisplayMode,
  writeDisplayMode,
  type DisplayMode,
} from "@/components/player-surface/ambient-video-background";
import { ModeGlyph } from "@/components/display-mode-switch";

const ORDER: DisplayMode[] = ["black", "white", "song"];

/**
 * Display mode in the gear menu (owner, 2026-10-14, second pass): a centred "Display" title, the three
 * original circle glyphs spread across one row, an elliptical outline around the row only while the
 * pointer is over it, and a small elliptical ring on the chosen one that glides to whatever is clicked.
 * No mode name. Same store as the hidden header pill. Display-only.
 */
export function DisplayModeMenuRow() {
  const { locale } = useLocale();
  const he = locale === "he";
  const mode = useDisplayMode();
  const { setLibraryTheme } = useLibraryTheme();
  const labels: Record<DisplayMode, string> = {
    black: he ? "שחור" : "Black",
    white: he ? "לבן" : "White",
    song: he ? "שקוף" : "Transparent",
  };
  const idx = Math.max(0, ORDER.indexOf(mode));
  const choose = (next: DisplayMode) => {
    writeDisplayMode(next);
    setLibraryTheme(libraryThemeForMode(next));
  };
  return (
    <div className={`sb-mode-section${he ? " is-he" : ""}`} role="radiogroup" aria-label={he ? "תצוגה" : "Display"}>
      <span className="sb-mode-title">{he ? "תצוגה" : "Display"}</span>
      <div className="sb-mode-row3" dir="ltr">
        <span className="sb-mode-hover-ring" aria-hidden />
        {/* the chosen-mode pill rides a one-column slot that slides on the compositor (transform only);
            the pill itself re-mounts per choice so its "bubble" stretch plays every time (owner: a slow,
            Apple-like pull — long ease-out tail). */}
        <span className="sb-mode-sel-slot" aria-hidden style={{ "--i": idx } as CSSProperties}>
          <span key={mode} className="sb-mode-sel-ring" />
        </span>
        {ORDER.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            aria-label={labels[m]}
            title={labels[m]}
            className="sb-mode-row3-btn"
            onClick={() => choose(m)}
          >
            <ModeGlyph mode={m} />
          </button>
        ))}
      </div>
    </div>
  );
}
