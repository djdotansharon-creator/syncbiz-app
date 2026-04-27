"use client";

/**
 * Test workspace tear-down: single modal, one typed confirmation (name only).
 * Server still enforces SUPER_ADMIN, self/owner preflight, and `confirmName` match.
 */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";

type Props = {
  workspaceId: string;
  name: string;
  slug: string;
  ownerId: string;
  ownerEmail: string;
  adminId: string;
  ownerIsSuperAdmin: boolean;
};

export default function WorkspaceTestDeleteButton({
  workspaceId,
  name,
  slug,
  ownerId,
  ownerEmail,
  adminId,
  ownerIsSuperAdmin,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [removeOwner, setRemoveOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState(false);
  const titleId = useId();

  const isOwnWorkspace = ownerId === adminId;
  const canOfferRemoveOwner = !ownerIsSuperAdmin && !isOwnWorkspace;
  const nameMatches = confirmInput.trim() === name.trim();
  const canSubmit = nameMatches && !submitting;

  const closeModal = useCallback(() => {
    if (submitting) return;
    setOpen(false);
    setConfirmInput("");
    setError(null);
    setRemoveOwner(false);
  }, [submitting]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, closeModal]);

  const onBackdropDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeModal();
  };

  async function onDelete() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/platform/workspaces/${encodeURIComponent(workspaceId)}/delete-test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            confirmName: confirmInput.trim(),
            removeOwnerUser: canOfferRemoveOwner && removeOwner,
          }),
        },
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (typeof data === "object" && data !== null && "error" in data
            ? String((data as { error?: unknown }).error)
            : null) ?? `Request failed (${res.status})`;
        setError(msg);
        return;
      }
      setOpen(false);
      setConfirmInput("");
      setRemoveOwner(false);
      const isList = pathname === "/admin/platform";
      if (isList) {
        setSuccessToast(true);
        setTimeout(() => setSuccessToast(false), 5000);
        router.refresh();
      } else {
        router.push("/admin/platform?wsDeleted=1");
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-1">
      {successToast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-[60] max-w-sm rounded border border-emerald-500/40 bg-emerald-950/90 px-4 py-2 text-sm text-emerald-100 shadow-lg"
        >
          Workspace deleted successfully.
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded border border-red-500/50 bg-red-950/30 px-2.5 py-1 text-[11px] font-medium text-red-200 hover:bg-red-950/50"
      >
        Delete test workspace
      </button>
      {!canOfferRemoveOwner && (
        <p className="text-[10px] text-neutral-500">
          {ownerIsSuperAdmin
            ? "Owner is SUPER_ADMIN — you can only delete the workspace, not the user via this tool."
            : isOwnWorkspace
              ? "This workspace is yours — owner auto-delete is disabled; you can still delete the workspace data."
              : null}
        </p>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="presentation"
          onMouseDown={onBackdropDown}
        >
          <div
            className="absolute inset-0 bg-black/70"
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative z-10 w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-950 p-5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id={titleId} className="text-lg font-semibold text-red-200">
              Delete test workspace
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              Internal use only. This cannot be undone.
            </p>

            <dl className="mt-4 space-y-2 text-sm text-neutral-200">
              <div>
                <dt className="text-[10px] uppercase text-neutral-500">Name</dt>
                <dd className="font-medium">{name}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-neutral-500">Slug</dt>
                <dd className="font-mono text-xs text-neutral-300">{slug}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-neutral-500">Owner</dt>
                <dd className="text-neutral-300">{ownerEmail}</dd>
              </div>
            </dl>

            <div className="mt-4 rounded border border-neutral-800 bg-neutral-900/60 p-3 text-xs text-neutral-400">
              <p className="font-medium text-neutral-300">What will be removed (database)</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>This workspace and its entitlement, members, branch assignments, branches, and devices</li>
                <li>Workspace-scoped sources, playlists, playlist items, schedules, billing/add-ons</li>
                <li>Guest sessions, announcements, AI DJ data linked to this workspace</li>
                <li>All workspace-scoped <code className="text-[10px]">AuditLog</code> rows (required for delete)</li>
              </ul>
              <p className="mt-2 text-[11px] text-neutral-500">
                Application code (playback, desktop, WebSocket, MPV) is not modified — only these rows in Postgres.
              </p>
            </div>

            {canOfferRemoveOwner && (
              <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={removeOwner}
                  onChange={(e) => setRemoveOwner(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Also remove the <strong>owner</strong> user account when safe (no other workspace, not SUPER_ADMIN,
                  not you; server validates).
                </span>
              </label>
            )}

            <div className="mt-4">
              <label htmlFor="ws-delete-confirm" className="block text-sm text-neutral-200">
                הקלד את שם ה-workspace כדי למחוק
              </label>
              <input
                id="ws-delete-confirm"
                type="text"
                value={confirmInput}
                onChange={(e) => {
                  setConfirmInput(e.target.value);
                  setError(null);
                }}
                autoComplete="off"
                className="mt-1.5 w-full rounded border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-red-500/50"
                placeholder={name}
                disabled={submitting}
              />
            </div>

            {error ? (
              <p className="mt-3 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200" role="alert">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={submitting}
                className="rounded border border-neutral-600 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={!canSubmit}
                className="rounded border border-red-500/50 bg-red-900/50 px-3 py-1.5 text-sm font-medium text-red-100 hover:bg-red-900/80 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "Deleting…" : "Delete workspace"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
