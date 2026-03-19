"use client";

import { useEffect, useState } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  /** When true, user must enter password before confirming. Verifies via /api/auth/verify-password. */
  requirePassword?: boolean;
};

/** Confirmation modal for switching to MASTER mode. Requires password when requirePassword is true. */
export function MasterControlConfirmModal({ isOpen, onClose, onConfirm, loading = false, requirePassword = true }: Props) {
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPassword("");
    setPasswordError(null);
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleConfirm() {
    if (requirePassword) {
      if (!password.trim()) {
        setPasswordError("Password is required");
        return;
      }
      setPasswordError(null);
      try {
        const res = await fetch("/api/auth/verify-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setPasswordError(data.error ?? "Invalid password");
          return;
        }
      } catch {
        setPasswordError("Verification failed");
        return;
      }
    }
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
          Changing this device to MASTER will stop playback from the current audio source. This action requires your password.
        </p>
        {requirePassword && (
          <div className="mt-4">
            <label htmlFor="master-password" className="block text-xs font-medium text-slate-500">
              Your password
            </label>
            <input
              id="master-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
              }}
              placeholder="Enter password"
              autoComplete="current-password"
              disabled={loading}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 disabled:opacity-50"
              aria-invalid={!!passwordError}
              aria-describedby={passwordError ? "master-password-error" : undefined}
            />
            {passwordError && (
              <p id="master-password-error" className="mt-1.5 text-xs text-rose-400">
                {passwordError}
              </p>
            )}
          </div>
        )}
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
