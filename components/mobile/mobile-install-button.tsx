"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "android" | "ios" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/**
 * "Install" — installing the PWA is what lets SyncBiz appear as a Web Share
 * Target (so you can share a song from Shazam into SyncBiz, like WhatsApp).
 *
 * This is a PURE button: no href, no `download` attribute, no navigation, and it
 * never opens the manifest/icon. It NEVER downloads a file.
 *   - If Chrome fired `beforeinstallprompt` → tap runs `prompt()` (native
 *     install dialog), then hides on `appinstalled`.
 *   - If not (event not received / iOS) → tap opens a short instructions sheet
 *     (Chrome menu → "Install app", or iOS Share → "Add to Home Screen").
 * Hidden entirely once already installed / running standalone.
 */
export function MobileInstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [installed, setInstalled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return (
      (window.matchMedia?.("(display-mode: standalone)").matches ?? false) ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  });
  const platform = detectPlatform();

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      setHelpOpen(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleClick = () => {
    if (deferred) {
      // Native install dialog — no download, no navigation.
      void deferred.prompt();
      void deferred.userChoice.finally(() => setDeferred(null));
    } else {
      // No install event available yet → show manual instructions instead.
      setHelpOpen(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Install SyncBiz"
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--sb-accent-border)] bg-[color:var(--sb-accent-soft)] px-3 text-[12px] font-semibold text-[#409cff] transition active:scale-95"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
        </svg>
        Install
      </button>

      {helpOpen && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Install SyncBiz">
          <button type="button" aria-label="Close" onClick={() => setHelpOpen(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-slate-700/60 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 p-5 pb-8 shadow-[0_-20px_60px_rgba(0,0,0,0.6)]">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-700" aria-hidden />
            <h2 className="mb-1 text-[17px] font-semibold text-slate-50">Install SyncBiz</h2>
            <p className="mb-4 text-[13px] text-slate-400">
              Add SyncBiz to your home screen{platform === "android" ? " — then you can share songs from Shazam straight into it." : "."}
            </p>
            {platform === "ios" ? (
              <ol className="space-y-2 text-[14px] text-slate-200">
                <li>1. Tap the <span className="font-semibold">Share</span> icon in Safari.</li>
                <li>2. Choose <span className="font-semibold">Add to Home Screen</span>.</li>
                <li>3. Tap <span className="font-semibold">Add</span>.</li>
              </ol>
            ) : (
              <ol className="space-y-2 text-[14px] text-slate-200">
                <li>1. Open the Chrome menu <span className="font-semibold">(⋮)</span> at the top-right.</li>
                <li>2. Tap <span className="font-semibold">Install app</span> (or <span className="font-semibold">Add to Home screen</span>).</li>
                <li>3. Confirm — SyncBiz appears on your home screen.</li>
              </ol>
            )}
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className="mt-5 w-full rounded-xl bg-[var(--sb-text)] py-2.5 text-[14px] font-semibold text-[#111114] active:scale-95"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
