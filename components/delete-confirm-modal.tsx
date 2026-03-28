"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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

const OVERLAY_CLASS =
  "fixed inset-0 z-[520] flex items-center justify-center bg-transparent p-4";

const PANEL_DEFAULT_CLASS =
  "relative w-full max-w-md rounded-2xl border border-slate-700/80 bg-gradient-to-b from-slate-900 to-slate-950 p-6 shadow-[0_24px_48px_rgba(0,0,0,0.5)] ring-1 ring-slate-800/80 max-h-[min(90dvh,40rem)] overflow-y-auto";

const BUTTON_ROW_DEFAULT_CLASS =
  "mt-8 flex w-full max-w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-3";

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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose, loading]);

  if (!isOpen || !mounted) return null;

  async function handleConfirm() {
    try {
      await onConfirm();
      onClose();
    } catch {
      // Keep modal open on error; parent can show feedback
    }
  }

  if (compact) {
    const overlay = (
      <div
        className={OVERLAY_CLASS}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        onClick={() => {
          if (!loading) onClose();
        }}
      >
        <div
          className="relative w-full max-w-xs rounded-2xl border border-slate-700/80 bg-gradient-to-b from-slate-900 to-slate-950 p-4 shadow-[0_24px_48px_rgba(0,0,0,0.5)] ring-1 ring-slate-800/80 max-h-[min(90dvh,40rem)] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="delete-modal-title" className="text-base font-semibold text-slate-100">
            {title ?? T.delete ?? "Delete"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {message ?? T.deleteSourceConfirm ?? "Are you sure?"}
          </p>
          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl border border-slate-600 bg-slate-800/90 px-3 py-2 text-sm font-medium text-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.2)] hover:border-slate-500 hover:bg-slate-700/90 disabled:opacity-50"
            >
              {cancelLabel ?? T.cancel ?? "Cancel"}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={loading}
              className="rounded-xl bg-gradient-to-b from-rose-500 to-rose-600 px-3 py-2 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(244,63,94,0.4)] hover:from-rose-400 hover:to-rose-500 disabled:opacity-50"
            >
              {loading ? (loadingLabel ?? T.deleting ?? "Deleting…") : (confirmLabel ?? T.confirmDelete ?? "Delete")}
            </button>
          </div>
        </div>
      </div>
    );
    return createPortal(overlay, document.body);
  }

  const overlay = (
    <div
      className={OVERLAY_CLASS}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div className={PANEL_DEFAULT_CLASS} onClick={(e) => e.stopPropagation()}>
        <h2 id="delete-modal-title" className="text-lg font-semibold text-slate-100">
          {title ?? T.delete ?? "Delete"}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          {message ?? T.deleteSourceConfirm ?? "Are you sure?"}
        </p>
        <div className={BUTTON_ROW_DEFAULT_CLASS}>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-full rounded-xl border border-slate-600 bg-slate-800/90 px-5 py-2.5 text-sm font-medium text-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.2)] hover:border-slate-500 hover:bg-slate-700/90 disabled:opacity-50 sm:w-auto"
          >
            {cancelLabel ?? T.cancel ?? "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-b from-rose-500 to-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(244,63,94,0.4)] hover:from-rose-400 hover:to-rose-500 disabled:opacity-50 sm:w-auto"
          >
            {loading ? (loadingLabel ?? T.deleting ?? "Deleting…") : (confirmLabel ?? T.confirmDelete ?? "Delete")}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
