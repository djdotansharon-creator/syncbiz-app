"use client";

import { useEffect } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
};

/** Confirmation modal for switching to MASTER mode. Same design pattern as DeleteConfirmModal. */
export function MasterControlConfirmModal({ isOpen, onClose, onConfirm, loading = false }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleConfirm() {
    try {
      await onConfirm();
      onClose();
    } catch {
      // Keep modal open on error
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="master-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700/80 bg-gradient-to-b from-slate-900 to-slate-950 p-6 shadow-[0_24px_48px_rgba(0,0,0,0.5)] ring-1 ring-slate-800/80"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="master-modal-title" className="text-lg font-semibold text-slate-100">
          Switch to MASTER
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Changing this device to MASTER will stop playback from the current audio source. Do you want to continue?
        </p>
        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl border border-slate-600 bg-slate-800/90 px-5 py-2.5 text-sm font-medium text-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.2)] hover:border-slate-500 hover:bg-slate-700/90 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={loading}
            className="rounded-xl bg-gradient-to-b from-sky-500 to-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(56,189,248,0.4)] hover:from-sky-400 hover:to-sky-500 disabled:opacity-50"
          >
            {loading ? "Switching…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
