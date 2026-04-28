"use client";

/**
 * Per-row Disable / Enable button for users in
 * `/admin/platform/workspaces/[id]`.
 *
 * Centered modals (no `alert` / `prompt` / `confirm`). Success: toast + `router.refresh()`.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, useTransition } from "react";

type Props = {
  userId: string;
  userEmail: string;
  status: "ACTIVE" | "PENDING" | "DISABLED" | string;
  isSuperAdmin: boolean;
  isSelf: boolean;
};

type ModalKind = "disable" | "enable" | null;

export default function UserPlatformActions({ userId, userEmail, status, isSuperAdmin, isSelf }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalKind>(null);
  const [disableReason, setDisableReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const titleId = useId();

  const open = (kind: Exclude<ModalKind, null>) => {
    setError(null);
    if (kind === "disable") setDisableReason("");
    setActiveModal(kind);
  };

  const closeModal = useCallback(() => {
    if (busy) return;
    setActiveModal(null);
    setError(null);
  }, [busy]);

  useEffect(() => {
    if (!activeModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [activeModal, closeModal]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (isSelf) {
    return (
      <span className="text-[11px] text-neutral-500" title="Leave this workspace via “Remove from workspace” in the Workspace column.">
        you
      </span>
    );
  }

  if (isSuperAdmin) {
    return (
      <span
        className="block max-w-[220px] text-[11px] leading-snug text-neutral-500"
        title="Use Platform Admin user actions to disable login platform-wide."
      >
        Global login: use Platform › Users. Remove pilot access in the Workspace column.
      </span>
    );
  }

  const isDisabled = status === "DISABLED";
  const disabled = busy || activeModal !== null;

  async function call(action: "disable" | "enable", reason: string | null, successMessage: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/platform/users/${encodeURIComponent(userId)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ reason }),
        },
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (typeof data === "object" && data !== null && "error" in data
            ? String((data as { error?: unknown }).error)
            : null) ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setActiveModal(null);
      setDisableReason("");
      setToast(successMessage);
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {isDisabled ? (
        <button
          type="button"
          onClick={() => open("enable")}
          disabled={disabled}
          className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && activeModal === "enable" ? "…" : "Enable login"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => open("disable")}
          disabled={disabled}
          className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && activeModal === "disable" ? "…" : "Disable login"}
        </button>
      )}

      {toast ? (
        <div
          role="status"
          className="fixed right-4 top-4 z-[60] max-w-sm rounded border border-emerald-500/40 bg-emerald-950/95 px-4 py-2 text-sm text-emerald-100 shadow-lg"
        >
          {toast}
        </div>
      ) : null}

      {activeModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close"
            onClick={closeModal}
          />
          <div
            className="relative w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-950 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {activeModal === "disable" ? (
              <>
                <h2 id={titleId} className="text-base font-semibold text-neutral-100">
                  Disable platform login
                </h2>
                <p className="mt-2 text-sm text-neutral-400">{userEmail}</p>
                <p className="mt-2 text-xs text-neutral-500">
                  This blocks login everywhere. Existing sessions become logged out on the next
                  request.
                </p>
                <label className="mt-3 block text-xs font-medium text-neutral-400">
                  Reason <span className="text-neutral-600">(optional)</span>
                </label>
                <textarea
                  className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200"
                  rows={2}
                  value={disableReason}
                  onChange={(e) => setDisableReason(e.target.value)}
                  placeholder="Visible in the audit log"
                />
                {error ? (
                  <p
                    className="mt-2 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
                    onClick={closeModal}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded border border-rose-500/40 bg-rose-600/20 px-3 py-1.5 text-sm font-medium text-rose-100 hover:bg-rose-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() =>
                      void call("disable", disableReason.trim() || null, `Disabled login for ${userEmail}.`)
                    }
                    disabled={busy}
                  >
                    {busy ? "Working…" : "Disable"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id={titleId} className="text-base font-semibold text-neutral-100">
                  Re-enable platform login
                </h2>
                <p className="mt-2 text-sm text-neutral-300">{userEmail}</p>
                {error ? (
                  <p
                    className="mt-2 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
                    onClick={closeModal}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded border border-emerald-500/40 bg-emerald-600/20 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void call("enable", null, `Re-enabled login for ${userEmail}.`)}
                    disabled={busy}
                  >
                    {busy ? "Working…" : "Enable"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
