"use client";

import { useLibraryTheme } from "@/lib/library-theme-context";
import { useLocale } from "@/lib/locale-context";
import {
  libraryThemeForMode,
  useDisplayMode,
  writeDisplayMode,
  type DisplayMode,
} from "@/components/player-surface/ambient-video-background";

const ORDER: DisplayMode[] = ["black", "white", "song"];
/** Column width of the rail (px) — the pill glides one column per step. Mirrors `.sb-mode-dots`. */
const STEP = 76;

/**
 * Display mode as a three-dot slider (owner, 2026-10-14): black · white · transparent sit on a
 * rail; a frameless pill glides to the chosen one. Same store as the (now hidden) header pill:
 * localStorage `syncbiz:displayMode` → html[data-sb-display]. Display-only.
 */
export function DisplayModeDots() {
  const mode = useDisplayMode();
  const { setLibraryTheme } = useLibraryTheme();
  const { locale } = useLocale();
  const he = locale === "he";
  const labels: Record<DisplayMode, string> = {
    black: he ? "שחור" : "Black",
    white: he ? "לבן" : "White",
    song: he ? "שקוף" : "Transparent",
  };
  const idx = Math.max(0, ORDER.indexOf(mode));
  const choose = (m: DisplayMode) => {
    writeDisplayMode(m);
    setLibraryTheme(libraryThemeForMode(m));
  };
  return (
    <div className="sb-mode-dots" role="radiogroup" aria-label={he ? "תצוגה" : "Display"} dir="ltr">
      <span className="sb-mode-dots-rail" aria-hidden />
      <span className="sb-mode-dots-pill" aria-hidden style={{ transform: `translateX(${idx * STEP}px)` }} />
      {ORDER.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          aria-label={labels[m]}
          title={labels[m]}
          className={`sb-mode-dot sb-mode-dot--${m}${mode === m ? " is-on" : ""}`}
          onClick={() => choose(m)}
        >
          <span className="sb-mode-dot-circle" aria-hidden />
          <span className="sb-mode-dot-label">{labels[m]}</span>
        </button>
      ))}
    </div>
  );
}
