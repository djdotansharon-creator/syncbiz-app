"use client";

/**
 * Platform Admin — remove membership for this workspace only (no global User delete).
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, useTransition } from "react";

type Props = {
  workspaceId: string;
  workspaceName: string;
  targetEmail: string;
  /** From {@link platformRemovalAllowedPreview} */
  canRemove: boolean;
  /** Shown when canRemove is false */
  disabledHint?: string;
};

export default function PlatformWorkspaceMemberRemoval({
  workspaceId,
  workspaceName,
  targetEmail,
  canRemove,
  disabledHint,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const titleId = useId();

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setTyped("");
    setError(null);
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!canRemove) {
    return (
      <span className="text-[11px] text-neutral-500" title={disabledHint ?? "Cannot remove this membership"}>
        —
      </span>
    );
  }

  async function submitRemove() {
    const e = targetEmail.trim().toLowerCase();
    if (typed.trim().toLowerCase() !== e) {
      setError('Type the exact email shown — your entry does not match this member.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/platform/workspaces/${encodeURIComponent(workspaceId)}/remove-member`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ email: targetEmail, confirmationEmail: typed }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setOpen(false);
      setTyped("");
      setToast(`${targetEmail} removed from workspace "${workspaceName}" (membership only).`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        title="Deletes WorkspaceMember and branch rows for this workspace only — never deletes the user account globally."
        onClick={() => {
          setError(null);
          setTyped('');
          setOpen(true);
        }}
        className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200 hover:bg-amber-500/20"
      >
        Remove from workspace
      </button>

      {toast ? (
        <div
          role="status"
          className="fixed right-4 top-4 z-[60] max-w-sm rounded border border-emerald-500/40 bg-emerald-950/95 px-4 py-2 text-sm text-emerald-100 shadow-lg"
        >
          {toast}
        </div>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close" onClick={close} />
          <div
            className="relative w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-950 p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <h2 id={titleId} className="text-base font-semibold text-neutral-100">
              Remove workspace membership
            </h2>
            <p className="mt-2 text-sm text-neutral-400">
              This removes{' '}
              <span className="font-mono text-amber-200/95">{targetEmail}</span> from workspace{' '}
              <strong className="text-neutral-200">{workspaceName}</strong> only (they keep their SyncBiz login and any
              other workspaces). Nothing is permanently deleted globally.
            </p>
            <p className="mt-3 text-xs text-rose-300/95">
              If this person is a platform super admin clearing a pilot membership, confirmation is deliberate — type their
              email below.
            </p>
            <label className="mt-3 block text-xs font-medium text-neutral-400">Type email to confirm</label>
            <input
              type="email"
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 font-mono text-sm text-neutral-200"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={targetEmail}
              autoComplete="off"
            />
            {error ? (
              <p className="mt-2 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200" role="alert">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
                onClick={close}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded border border-amber-500/40 bg-amber-600/25 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-600/35 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                onClick={() => void submitRemove()}
              >
                {busy ? "Removing…" : "Remove membership"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
