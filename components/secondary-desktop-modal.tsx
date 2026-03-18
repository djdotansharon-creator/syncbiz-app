"use client";

import { useEffect } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

/** Informational modal when a second desktop opens while another is MASTER. */
export function SecondaryDesktopModal({ isOpen, onClose }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="secondary-desktop-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700/80 bg-gradient-to-b from-slate-900 to-slate-950 p-6 shadow-[0_24px_48px_rgba(0,0,0,0.5)] ring-1 ring-slate-800/80"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="secondary-desktop-modal-title" className="text-lg font-semibold text-slate-100">
          Main player already active
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Another desktop session is already acting as MASTER for this account. This device will open in CONTROL mode.
        </p>
        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gradient-to-b from-sky-500 to-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(56,189,248,0.4)] hover:from-sky-400 hover:to-sky-500"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
