"use client";

import { useLibraryTheme, type LibraryVisualTheme } from "@/lib/library-theme-context";
import { useTranslations } from "@/lib/locale-context";

const MODES: LibraryVisualTheme[] = ["deep-blue", "graphite-black"];

/** BLUE / BLACK — minimal system control (EN/HE toggle language, not a feature control). */
export function LibraryThemeMenu() {
  const { libraryTheme, setLibraryTheme } = useLibraryTheme();
  const { t } = useTranslations();

  return (
    <div
      className="library-theme-toggle flex h-6 shrink-0 items-stretch rounded-md border border-slate-700/80 bg-slate-900/60 p-px"
      role="group"
      aria-label={t.themeLibraryLook}
    >
      {MODES.map((id) => {
        const active = libraryTheme === id;
        const label = id === "deep-blue" ? t.themeShortBlue : t.themeShortBlack;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            title={id === "deep-blue" ? t.themeDeepBlue : t.themeGraphiteBlack}
            onClick={() => setLibraryTheme(id)}
            className={`flex min-w-0 flex-1 items-center justify-center rounded-[5px] px-1.5 text-[9px] font-medium uppercase leading-none tracking-wide transition ${
              active ? "library-theme-toggle-btn--active" : "library-theme-toggle-btn--idle"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
