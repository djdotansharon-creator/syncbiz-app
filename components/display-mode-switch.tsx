"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "@/lib/locale-context";
import { useLibraryTheme } from "@/lib/library-theme-context";
import {
  libraryThemeForMode,
  useDisplayMode,
  writeDisplayMode,
  type DisplayMode,
} from "@/components/player-surface/ambient-video-background";

/**
 * Header switch for the display mode (black / white / transparent) — a quiet icon button that
 * opens a three-row menu. Same storage + theme sync as the Settings control. Presentational only.
 */
export function DisplayModeSwitch({ compact = false }: { compact?: boolean }) {
  const { locale } = useLocale();
  const he = locale === "he";
  const mode = useDisplayMode();
  const { setLibraryTheme } = useLibraryTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const modes: { id: DisplayMode; label: string; hint: string }[] = [
    { id: "black", label: he ? "שחור" : "Black", hint: he ? "כהה וניטרלי" : "Dark, neutral" },
    { id: "white", label: he ? "לבן" : "White", hint: he ? "בהיר" : "Light" },
    { id: "song", label: he ? "שקוף" : "Transparent", hint: he ? "צבעי השיר על כל המערכת" : "The track's colours everywhere" },
  ];
  const current = modes.find((m) => m.id === mode) ?? modes[2];

  const choose = (next: DisplayMode) => {
    writeDisplayMode(next);
    setLibraryTheme(libraryThemeForMode(next));
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="sb-display-switch relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={(he ? "תצוגה: " : "Display: ") + current.label}
        className={`sb-display-switch-btn inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-[#c7c7cc] transition-colors hover:bg-white/[0.08] hover:text-[#f5f5f7] focus:outline-none focus-visible:bg-white/[0.08] ${
          open ? "bg-white/[0.08] text-[#f5f5f7]" : ""
        }`}
      >
        <ModeGlyph mode={mode} />
        {!compact ? <span className="hidden lg:inline">{current.label}</span> : null}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={he ? "תצוגה" : "Display"}
          className="sb-display-switch-menu sb-anim-pop absolute right-0 top-[calc(100%+6px)] z-[80] min-w-[190px] overflow-hidden rounded-xl p-1"
          dir={he ? "rtl" : "ltr"}
        >
          {modes.map((m) => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => choose(m.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13px] transition-colors ${
                  active ? "bg-white/[0.10] text-[#f5f5f7]" : "text-[#d1d1d6] hover:bg-white/[0.06] hover:text-[#f5f5f7]"
                }`}
              >
                <ModeGlyph mode={m.id} />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium leading-tight">{m.label}</span>
                  <span className="text-[11px] leading-tight text-[#8e8e93]">{m.hint}</span>
                </span>
                {active ? (
                  <svg className="ms-auto h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 8.5l3 3 7-7" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ModeGlyph({ mode }: { mode: DisplayMode }) {
  const common = { className: "h-4 w-4 shrink-0", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (mode === "black") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (mode === "white") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M4.5 9.5c1.2-1.4 2.4-1.4 3.5 0s2.3 1.4 3.5 0" />
      <path d="M4.5 6.5c1.2-1.4 2.4-1.4 3.5 0s2.3 1.4 3.5 0" />
    </svg>
  );
}
