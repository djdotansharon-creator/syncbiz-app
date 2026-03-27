"use client";

import { LibraryThemeMenu } from "@/components/library-theme-menu";
import { useLocale } from "@/lib/locale-context";

export function SettingsPreferencesControls() {
  const { locale, setLocale } = useLocale();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Theme</p>
        <p className="mt-0.5 text-[11px] text-slate-500">Library visual mode for /sources.</p>
        <div className="mt-2 inline-flex">
          <LibraryThemeMenu />
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Language</p>
        <p className="mt-0.5 text-[11px] text-slate-500">Application display language.</p>
        <div
          className="mt-2 inline-flex rounded-lg border border-slate-700/80 bg-slate-900/60 p-0.5"
          role="group"
          aria-label="Language"
        >
          <button
            type="button"
            onClick={() => setLocale("en")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              locale === "en" ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
            aria-pressed={locale === "en"}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLocale("he")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              locale === "he" ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
            aria-pressed={locale === "he"}
          >
            HE
          </button>
        </div>
      </div>
    </div>
  );
}
