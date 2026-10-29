"use client";

/** Shown instead of the app when a person's role does not allow signing in from a computer (docs/ROLES_DESIGN.md). Plain black, one sentence, one way out. */

import { LocaleProvider } from "@/lib/locale-context";
import { useTr } from "@/lib/i18n/use-tr";

function Card() {
  const tr = useTr();
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6 text-center text-white">
      <div className="max-w-sm">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mx-auto text-white/70">
          <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
          <path d="M11 18.5h2" />
        </svg>
        <h1 className="mt-5 text-lg font-semibold">{tr("Sign in from your phone")}</h1>
        <p className="mt-2 text-sm text-white/60">{tr("This account can only be used from a phone.")}</p>
        <button
          type="button"
          className="mt-6 rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-black hover:bg-white"
          onClick={() => {
            void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).finally(() => window.location.assign("/login"));
          }}
        >
          {tr("Sign out")}
        </button>
      </div>
    </div>
  );
}

export function ComputerBlocked() {
  return (
    <LocaleProvider>
      <Card />
    </LocaleProvider>
  );
}
