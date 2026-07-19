"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * "Install SyncBiz" — installing the PWA is what lets it appear as a Web Share
 * Target (so you can share a song from Shazam into SyncBiz, like WhatsApp).
 *
 *  - Android/Chrome: captures `beforeinstallprompt`, shows the button, calls
 *    prompt() on tap; hides once installed / already running standalone.
 *  - iOS/other (no beforeinstallprompt): renders nothing — iOS can't register a
 *    Web Share Target anyway, so we don't nag with Add-to-Home-Screen here.
 */
export function MobileInstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return (
      (window.matchMedia?.("(display-mode: standalone)").matches ?? false) ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  });

  useEffect(() => {
    if (installed) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
    // Listeners are set up once at mount; `installed` is only read for the
    // mount-time skip, and onInstalled flips it via state → re-render hides us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (installed || !deferred) return null;

  return (
    <button
      type="button"
      onClick={() => {
        void deferred.prompt();
        void deferred.userChoice.finally(() => setDeferred(null));
      }}
      aria-label="Install SyncBiz"
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--sb-accent-border)] bg-[color:var(--sb-accent-soft)] px-3 text-[12px] font-semibold text-[#409cff] transition active:scale-95"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
      </svg>
      Install
    </button>
  );
}
