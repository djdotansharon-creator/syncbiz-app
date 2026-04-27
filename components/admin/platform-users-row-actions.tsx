"use client";

/**
 * Per-row actions on `/admin/platform/users`: disable/enable, set password,
 * safe hard-delete — all via centered modals (no browser dialog APIs).
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, useTransition } from "react";

type ModalKind = "safe" | "disable" | "enable" | "password" | null;
type SubmittingKind = "safe" | "disable" | "enable" | "password" | null;

type Props = {
  userId: string;
  userEmail: string;
  userRole: string;
  status: string;
  isSuperAdmin: boolean;
  isSelf: boolean;
  canSafeDelete: boolean;
  /** True when user has no owner role and no member/branch rows (orphan row). */
  orphan: boolean;
  /** True when user has at least one WorkspaceMember or UserBranchAssignment row. */
  hasWorkspaceTies: boolean;
};

function parseApiError(data: unknown, res: Response): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    return String((data as { error?: unknown }).error);
  }
  return `HTTP ${res.status}`;
}

const PW_MIN = 6;
const PW_MAX = 128;

export default function PlatformUsersRowActions({
  userId,
  userEmail,
  userRole,
  status,
  isSuperAdmin,
  isSelf,
  canSafeDelete,
  orphan,
  hasWorkspaceTies,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openKind, setOpenKind] = useState<ModalKind>(null);
  const [submitting, setSubmitting] = useState<SubmittingKind>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [confirmEmail, setConfirmEmail] = useState("");
  const [disableReason, setDisableReason] = useState("");
  const [enableReason, setEnableReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordTemporary, setPasswordTemporary] = useState(false);

  const titleSafeId = useId();
  const titleDisableId = useId();
  const titleEnableId = useId();
  const titlePasswordId = useId();

  const isRowBusy = isPending || submitting !== null;
  const isDisabled = status === "DISABLED";

  const emailMatches =
    confirmEmail.trim().toLowerCase() === userEmail.trim().toLowerCase();
  const canSubmitSafe = emailMatches && submitting !== "safe" && !isPending;

  const passwordLen = newPassword.length;
  const passwordsMatch = newPassword === confirmPassword;
  const passwordValid =
    passwordLen >= PW_MIN &&
    passwordLen <= PW_MAX &&
    passwordsMatch;
  const canSavePassword = passwordValid && submitting !== "password" && !isPending;

  const canClose = submitting === null;

  const onClose = useCallback(() => {
    if (!canClose) return;
    setOpenKind(null);
    setModalError(null);
    setConfirmEmail("");
    setDisableReason("");
    setEnableReason("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordTemporary(false);
  }, [canClose]);

  const anyModalOpen = openKind !== null;

  useEffect(() => {
    if (!anyModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canClose) onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [anyModalOpen, canClose, onClose]);

  function onBackdropDown(e: React.MouseEvent) {
    if (e.target === e.currentTarget && canClose) onClose();
  }

  function showSuccess(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  }

  async function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  function openSafe() {
    setModalError(null);
    setConfirmEmail("");
    setOpenKind("safe");
  }

  function openDisable() {
    setModalError(null);
    setDisableReason("");
    setOpenKind("disable");
  }

  function openEnable() {
    setModalError(null);
    setEnableReason("");
    setOpenKind("enable");
  }

  function openPassword() {
    setModalError(null);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordTemporary(false);
    setOpenKind("password");
  }

  async function submitDisable() {
    setModalError(null);
    setSubmitting("disable");
    try {
      const res = await fetch(
        `/api/admin/platform/users/${encodeURIComponent(userId)}/disable`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            reason: disableReason.trim() || null,
          }),
        },
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setModalError(parseApiError(data, res));
        return;
      }
      setOpenKind(null);
      setDisableReason("");
      setModalError(null);
      showSuccess("User disabled successfully.");
      await refresh();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(null);
    }
  }

  async function submitEnable() {
    setModalError(null);
    setSubmitting("enable");
    try {
      const res = await fetch(
        `/api/admin/platform/users/${encodeURIComponent(userId)}/enable`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            reason: enableReason.trim() || null,
          }),
        },
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setModalError(parseApiError(data, res));
        return;
      }
      setOpenKind(null);
      setEnableReason("");
      setModalError(null);
      showSuccess("User enabled successfully.");
      await refresh();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(null);
    }
  }

  async function submitPassword() {
    if (!canSavePassword) return;
    setModalError(null);
    setSubmitting("password");
    try {
      const res = await fetch(
        `/api/admin/platform/users/${encodeURIComponent(userId)}/set-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            newPassword,
            temporary: passwordTemporary,
          }),
        },
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setModalError(parseApiError(data, res));
        return;
      }
      setOpenKind(null);
      setNewPassword("");
      setConfirmPassword("");
      setPasswordTemporary(false);
      setModalError(null);
      showSuccess("Password updated successfully.");
      await refresh();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(null);
    }
  }

  async function submitSafeDelete() {
    if (!canSubmitSafe) return;
    setModalError(null);
    setSubmitting("safe");
    try {
      const res = await fetch(
        `/api/admin/platform/users/${encodeURIComponent(userId)}/delete`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            confirmEmail: confirmEmail.trim().toLowerCase(),
          }),
        },
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setModalError(parseApiError(data, res));
        return;
      }
      setOpenKind(null);
      setConfirmEmail("");
      setModalError(null);
      showSuccess("User deleted successfully.");
      await refresh();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(null);
    }
  }

  const accountLabel = orphan
    ? "Orphan — no owned workspaces; no WorkspaceMember or UserBranchAssignment rows."
    : hasWorkspaceTies
      ? "Test / member user — has WorkspaceMember and/or UserBranchAssignment rows; those are removed first, then the User row."
      : "—";

  const modalBusy = (k: NonNullable<ModalKind>) => submitting === k;
  const primarySubmitting = submitting !== null;

  return (
    <div className="flex flex-col gap-1">
      {toast ? (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-[60] max-w-sm rounded border border-emerald-500/40 bg-emerald-950/90 px-4 py-2 text-sm text-emerald-100 shadow-lg"
        >
          {toast}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {isSelf ? (
          <span className="text-[10px] text-neutral-500">(you) no disable/enable</span>
        ) : isSuperAdmin ? (
          <span className="text-[10px] text-neutral-500">no disable (SUPER_ADMIN)</span>
        ) : isDisabled ? (
          <button
            type="button"
            onClick={openEnable}
            disabled={isRowBusy}
            className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            Enable
          </button>
        ) : (
          <button
            type="button"
            onClick={openDisable}
            disabled={isRowBusy}
            className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
          >
            Disable
          </button>
        )}
        <button
          type="button"
          onClick={openPassword}
          disabled={isRowBusy}
          className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
        >
          Set password
        </button>
        {canSafeDelete && !isSelf && (
          <button
            type="button"
            onClick={openSafe}
            disabled={isRowBusy}
            className="rounded border border-red-600/40 bg-red-900/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300 hover:bg-red-900/40 disabled:opacity-50"
          >
            Safe delete
          </button>
        )}
      </div>

      {openKind ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="presentation"
          onMouseDown={onBackdropDown}
        >
          <div className="absolute inset-0 bg-black/70" aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-950 p-5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            aria-labelledby={
              openKind === "safe"
                ? titleSafeId
                : openKind === "disable"
                  ? titleDisableId
                  : openKind === "enable"
                    ? titleEnableId
                    : titlePasswordId
            }
          >
            {openKind === "disable" ? (
              <>
                <h2
                  id={titleDisableId}
                  className="text-lg font-semibold text-rose-200"
                >
                  Disable user
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Blocks platform login. Membership rows are unchanged; sessions end on the next
                  request.
                </p>
                <dl className="mt-4 space-y-2 text-sm text-neutral-200">
                  <div>
                    <dt className="text-[10px] uppercase text-neutral-500">Email</dt>
                    <dd className="break-all font-mono text-xs">{userEmail}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-neutral-500">Role / status</dt>
                    <dd>
                      <span className="font-mono text-xs text-neutral-300">{userRole}</span>
                      {" · "}
                      <span className="text-neutral-300">{status}</span>
                    </dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <label
                    htmlFor="pl-disable-reason"
                    className="block text-sm text-neutral-200"
                  >
                    Reason <span className="text-neutral-500">(optional)</span>
                  </label>
                  <textarea
                    id="pl-disable-reason"
                    value={disableReason}
                    onChange={(e) => {
                      setDisableReason(e.target.value);
                      setModalError(null);
                    }}
                    rows={2}
                    disabled={modalBusy("disable")}
                    className="mt-1.5 w-full resize-y rounded border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-rose-500/40"
                    placeholder="Visible in platform audit log"
                  />
                </div>
                {modalError ? (
                  <p
                    className="mt-3 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200"
                    role="alert"
                  >
                    {modalError}
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={primarySubmitting}
                    className="rounded border border-neutral-600 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitDisable}
                    disabled={modalBusy("disable")}
                    className="rounded border border-rose-500/50 bg-rose-900/50 px-3 py-1.5 text-sm font-medium text-rose-100 hover:bg-rose-900/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {modalBusy("disable") ? "Disabling…" : "Disable"}
                  </button>
                </div>
              </>
            ) : null}

            {openKind === "enable" ? (
              <>
                <h2
                  id={titleEnableId}
                  className="text-lg font-semibold text-emerald-200"
                >
                  Re-enable user
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Restores <code className="text-[10px]">ACTIVE</code> status; user can sign in
                  again.
                </p>
                <dl className="mt-4 space-y-2 text-sm text-neutral-200">
                  <div>
                    <dt className="text-[10px] uppercase text-neutral-500">Email</dt>
                    <dd className="break-all font-mono text-xs">{userEmail}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-neutral-500">Role / status</dt>
                    <dd>
                      <span className="font-mono text-xs text-neutral-300">{userRole}</span>
                      {" · "}
                      <span className="text-neutral-300">{status}</span>
                    </dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <label
                    htmlFor="pl-enable-reason"
                    className="block text-sm text-neutral-200"
                  >
                    Reason <span className="text-neutral-500">(optional)</span>
                  </label>
                  <textarea
                    id="pl-enable-reason"
                    value={enableReason}
                    onChange={(e) => {
                      setEnableReason(e.target.value);
                      setModalError(null);
                    }}
                    rows={2}
                    disabled={modalBusy("enable")}
                    className="mt-1.5 w-full resize-y rounded border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/40"
                    placeholder="Visible in platform audit log"
                  />
                </div>
                {modalError ? (
                  <p
                    className="mt-3 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200"
                    role="alert"
                  >
                    {modalError}
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={primarySubmitting}
                    className="rounded border border-neutral-600 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitEnable}
                    disabled={modalBusy("enable")}
                    className="rounded border border-emerald-500/50 bg-emerald-900/50 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-900/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {modalBusy("enable") ? "Enabling…" : "Enable"}
                  </button>
                </div>
              </>
            ) : null}

            {openKind === "password" ? (
              <>
                <h2
                  id={titlePasswordId}
                  className="text-lg font-semibold text-amber-200"
                >
                  Set password
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Stored as a hash only. The password is not written to the audit log (metadata may
                  include length and “temporary” flag only).
                </p>
                <div className="mt-4">
                  <p className="text-[10px] uppercase text-neutral-500">Email</p>
                  <p className="mt-0.5 break-all font-mono text-xs text-neutral-200">
                    {userEmail}
                  </p>
                </div>
                <div className="mt-4 space-y-3">
                  <div>
                    <label
                      htmlFor="pl-pw-new"
                      className="block text-sm text-neutral-200"
                    >
                      New password
                    </label>
                    <input
                      id="pl-pw-new"
                      type="password"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setModalError(null);
                      }}
                      autoComplete="new-password"
                      disabled={modalBusy("password")}
                      className="mt-1.5 w-full rounded border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-amber-500/40"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="pl-pw-confirm"
                      className="block text-sm text-neutral-200"
                    >
                      Confirm password
                    </label>
                    <input
                      id="pl-pw-confirm"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setModalError(null);
                      }}
                      autoComplete="new-password"
                      disabled={modalBusy("password")}
                      className="mt-1.5 w-full rounded border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-amber-500/40"
                    />
                  </div>
                  {passwordLen > 0 && passwordLen < PW_MIN ? (
                    <p className="text-xs text-amber-200/80">
                      At least {PW_MIN} characters.
                    </p>
                  ) : null}
                  {passwordLen > PW_MAX ? (
                    <p className="text-xs text-amber-200/80">
                      At most {PW_MAX} characters.
                    </p>
                  ) : null}
                  {newPassword.length > 0 && confirmPassword.length > 0 && !passwordsMatch ? (
                    <p className="text-xs text-rose-200/90">Passwords do not match.</p>
                  ) : null}
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-300">
                    <input
                      type="checkbox"
                      checked={passwordTemporary}
                      onChange={(e) => setPasswordTemporary(e.target.checked)}
                      disabled={modalBusy("password")}
                      className="mt-0.5"
                    />
                    <span>
                      Mark as temporary in audit metadata (hash storage is the same; team hint only)
                    </span>
                  </label>
                </div>
                {modalError ? (
                  <p
                    className="mt-3 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200"
                    role="alert"
                  >
                    {modalError}
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={primarySubmitting}
                    className="rounded border border-neutral-600 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitPassword}
                    disabled={!canSavePassword}
                    className="rounded border border-amber-500/50 bg-amber-900/50 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-900/80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {modalBusy("password") ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            ) : null}

            {openKind === "safe" ? (
              <>
                <h2 id={titleSafeId} className="text-lg font-semibold text-red-200">
                  Safe delete user
                </h2>
                <p className="mt-1 text-xs text-neutral-500">Internal use only. Cannot be undone.</p>

                <dl className="mt-4 space-y-2 text-sm text-neutral-200">
                  <div>
                    <dt className="text-[10px] uppercase text-neutral-500">Email</dt>
                    <dd className="break-all font-mono text-xs">{userEmail}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-neutral-500">Role / status</dt>
                    <dd>
                      <span className="font-mono text-xs text-neutral-300">{userRole}</span>
                      {" · "}
                      <span className="text-neutral-300">{status}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-neutral-500">Account type</dt>
                    <dd className="text-xs text-neutral-400 leading-relaxed">{accountLabel}</dd>
                  </div>
                </dl>

                <div className="mt-4 rounded border border-neutral-800 bg-neutral-900/60 p-3 text-xs text-neutral-400">
                  <p className="font-medium text-neutral-300">What will be removed</p>
                  <p className="mt-2">
                    In one transaction: all <code className="text-[10px]">UserBranchAssignment</code> and{" "}
                    <code className="text-[10px]">WorkspaceMember</code> rows for this user, then the{" "}
                    <code className="text-[10px]">User</code> row. A{" "}
                    <code className="text-[10px]">user.safe_account_delete</code> event is written
                    to the platform audit log.
                  </p>
                  <p className="mt-3 text-[11px] text-amber-200/80">
                    Refused on the server for: <strong className="text-amber-100">SUPER_ADMIN</strong>, your own
                    account, <strong className="text-amber-100">workspace owner</strong> (any owned workspace), or
                    blockers: workspace <code className="text-[10px]">AuditLog</code> on the user, guest sessions, AI
                    DJ
                    sessions. Application code (playback, desktop, WebSocket, MPV, playlists, schedules) is not
                    modified.
                  </p>
                </div>

                <div className="mt-4">
                  <label htmlFor="safe-del-email" className="block text-sm text-neutral-200">
                    הקלד את email של המשתמש כדי למחוק
                  </label>
                  <input
                    id="safe-del-email"
                    type="text"
                    value={confirmEmail}
                    onChange={(e) => {
                      setConfirmEmail(e.target.value);
                      setModalError(null);
                    }}
                    autoComplete="off"
                    className="mt-1.5 w-full rounded border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-red-500/50"
                    placeholder={userEmail}
                    disabled={modalBusy("safe")}
                  />
                </div>

                {modalError ? (
                  <p
                    className="mt-3 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200"
                    role="alert"
                  >
                    {modalError}
                  </p>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={primarySubmitting}
                    className="rounded border border-neutral-600 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitSafeDelete}
                    disabled={!canSubmitSafe}
                    className="rounded border border-red-500/50 bg-red-900/50 px-3 py-1.5 text-sm font-medium text-red-100 hover:bg-red-900/80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {modalBusy("safe") ? "Deleting…" : "Safe delete user"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
