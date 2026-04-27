"use client";

/**
 * Per-row Disable / Enable button for users in
 * `/admin/platform/workspaces/[id]`.
 *
 * Calls `/api/admin/platform/users/[id]/disable` or `/enable`. After a
 * successful write, `router.refresh()` re-renders the parent server
 * component so the user's badge and the audit list update.
 *
 * Hard guards (UI mirrors of server-side checks):
 * - SUPER_ADMIN targets render no button (the API would 403).
 * - The current admin's own row renders no button (would 400).
 *
 * "Disable" globally locks login (`User.status = "DISABLED"` is checked
 * in `lib/auth.ts::validateCredentialsAsync` and `getUserByEmail`).
 * The reason field is optional but recommended; it lands in
 * `PlatformAuditLog.metadata.reason`.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  userId: string;
  userEmail: string;
  status: "ACTIVE" | "PENDING" | "DISABLED" | string;
  isSuperAdmin: boolean;
  isSelf: boolean;
};

export default function UserPlatformActions({ userId, userEmail, status, isSuperAdmin, isSelf }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  if (isSuperAdmin) {
    return <span className="text-[11px] text-neutral-500">platform admin</span>;
  }
  if (isSelf) {
    return <span className="text-[11px] text-neutral-500">you</span>;
  }

  const isDisabled = status === "DISABLED";

  async function call(action: "disable" | "enable", reason: string | null) {
    setBusy(true);
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
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Failed to ${action} ${userEmail}:\n${msg}`);
    } finally {
      setBusy(false);
    }
  }

  function onDisable() {
    const reason = window.prompt(
      `Disable platform login for "${userEmail}"?\n\n` +
        `This blocks login everywhere. Existing sessions will resolve to logged-out on next request.\n\n` +
        `Optional reason (visible in audit log):`,
      "",
    );
    if (reason === null) return;
    void call("disable", reason.trim() || null);
  }

  function onEnable() {
    const ok = window.confirm(`Re-enable platform login for "${userEmail}"?`);
    if (!ok) return;
    void call("enable", null);
  }

  const disabled = isPending || busy;

  if (isDisabled) {
    return (
      <button
        type="button"
        onClick={onEnable}
        disabled={disabled}
        className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "…" : "Enable"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onDisable}
      disabled={disabled}
      className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? "…" : "Disable"}
    </button>
  );
}
