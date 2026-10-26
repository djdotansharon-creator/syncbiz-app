"use client";

import { useLocale, useTranslations } from "@/lib/locale-context";
import { useLibraryTheme } from "@/lib/library-theme-context";
import { LanguageSelector } from "@/components/language-selector";
import {
  libraryThemeForMode,
  useDisplayMode,
  writeDisplayMode,
  type DisplayMode,
} from "@/components/player-surface/ambient-video-background";

export function SettingsPreferencesControls() {
  const { locale } = useLocale();
  const { t } = useTranslations();
  const mode = useDisplayMode();
  const { setLibraryTheme } = useLibraryTheme();
  const he = locale === "he";

  const choose = (next: DisplayMode) => {
    writeDisplayMode(next);
    setLibraryTheme(libraryThemeForMode(next));
  };

  const modes: { id: DisplayMode; label: string }[] = [
    { id: "black", label: he ? "שחור" : "Black" },
    { id: "white", label: he ? "לבן" : "White" },
    { id: "song", label: he ? "שקוף" : "Transparent" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          {he ? "תצוגה" : "Display"}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {he
            ? "שחור, לבן, או שקוף: צבעי השיר המתנגן נמרחים מטושטשים על כל המערכת."
            : "Black, white, or transparent: the playing track's colours washed over the whole page."}
        </p>
        <div
          className="mt-2 inline-flex rounded-lg border border-slate-700/80 bg-slate-900/60 p-0.5"
          role="group"
          aria-label={he ? "תצוגה" : "Display"}
        >
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => choose(m.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                mode === m.id ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
              }`}
              aria-pressed={mode === m.id}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{t.settingsLanguage}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{t.settingsLanguageDesc}</p>
        {/* 2026-10-14 (owner): one small button → a compact scrolling list of flags + names */}
        <div className="mt-2">
          <LanguageSelector variant="settings" />
        </div>
      </div>
    </div>
  );
}
