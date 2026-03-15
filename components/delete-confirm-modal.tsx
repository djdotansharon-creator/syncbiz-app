"use client";

import { useEffect } from "react";
import { useTranslations } from "@/lib/locale-context";

type DeleteConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  loadingLabel?: string;
  /** Compact layout for smaller confirmations (e.g. logout) */
  compact?: boolean;
};

export function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  loading = false,
  loadingLabel,
  compact = false,
}: DeleteConfirmModalProps) {
  const { t } = useTranslations();
  const T = t as unknown as Record<string, string>;

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
      // Keep modal open on error; parent can show feedback
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      onClick={onClose}
    >
      <div
        className={`w-full rounded-2xl border border-slate-700/80 bg-gradient-to-b from-slate-900 to-slate-950 shadow-[0_24px_48px_rgba(0,0,0,0.5)] ring-1 ring-slate-800/80 ${
          compact ? "max-w-xs p-4" : "max-w-md p-6"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-modal-title" className={`font-semibold text-slate-100 ${compact ? "text-base" : "text-lg"}`}>
          {title ?? T.delete ?? "Delete"}
        </h2>
        <p className={`text-sm leading-relaxed text-slate-400 ${compact ? "mt-2" : "mt-3"}`}>
          {message ?? T.deleteSourceConfirm ?? "Are you sure?"}
        </p>
        <div className={`flex justify-end gap-3 ${compact ? "mt-4" : "mt-8"}`}>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className={`rounded-xl border border-slate-600 bg-slate-800/90 text-sm font-medium text-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.2)] hover:border-slate-500 hover:bg-slate-700/90 disabled:opacity-50 ${compact ? "px-3 py-2" : "px-5 py-2.5"}`}
          >
            {cancelLabel ?? T.cancel ?? "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={loading}
            className={`rounded-xl bg-gradient-to-b from-rose-500 to-rose-600 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(244,63,94,0.4)] hover:from-rose-400 hover:to-rose-500 disabled:opacity-50 ${compact ? "px-3 py-2" : "px-5 py-2.5"}`}
          >
            {loading ? (loadingLabel ?? T.deleting ?? "Deleting…") : (confirmLabel ?? T.confirmDelete ?? "Delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
