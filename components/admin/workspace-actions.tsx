"use client";

/**
 * Per-row action menu for `/admin/platform`.
 *
 * Renders Suspend / Unsuspend / Extend-trial buttons next to a workspace,
 * shows different sets based on current status, and POSTs to the
 * `app/api/admin/platform/workspaces/[id]/...` endpoints. After a
 * successful write it calls `router.refresh()` so the server-rendered
 * table re-queries Postgres and reflects the new state.
 *
 * V1 UX is intentionally minimal: native `prompt`/`confirm` dialogs
 * instead of a custom modal — the audience is the SyncBiz platform
 * owner, and the table sees a handful of writes per pilot. Polished
 * modal UI can land later without changing the API contract.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Status = "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | null | undefined;

type Props = {
  workspaceId: string;
  workspaceName: string;
  status: Status;
  hasEntitlement: boolean;
};

export default function WorkspaceActions({
  workspaceId,
  workspaceName,
  status,
  hasEntitlement,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  if (!hasEntitlement) {
    // No entitlement row → mutating endpoints will all 409. Surface that
    // up front rather than show buttons that always fail.
    return <span className="text-[11px] text-amber-400">backfill needed</span>;
  }

  const isSuspended = status === "SUSPENDED";

  async function call(
    action: "suspend" | "unsuspend" | "extend-trial",
    body: Record<string, unknown> | null,
  ) {
    setBusyAction(action);
    try {
      const res = await fetch(
        `/api/admin/platform/workspaces/${encodeURIComponent(workspaceId)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : "{}",
          cache: "no-store",
        },
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          (typeof data === "object" && data !== null && "error" in data
            ? String((data as { error?: unknown }).error)
            : null) ?? `HTTP ${res.status}`;
        throw new Error(message);
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      alert(`Failed to ${action} "${workspaceName}":\n${message}`);
    } finally {
      setBusyAction(null);
    }
  }

  function onSuspend() {
    const reason = window.prompt(
      `Suspend "${workspaceName}"?\n\nOptional reason (visible in audit log):`,
      "",
    );
    // null = user cancelled; empty string is allowed (no reason).
    if (reason === null) return;
    void call("suspend", { reason: reason.trim() || null });
  }

  function onUnsuspend() {
    const ok = window.confirm(
      `Unsuspend "${workspaceName}"?\n\nWorkspace will return to TRIALING (if trial is still active) or ACTIVE.`,
    );
    if (!ok) return;
    void call("unsuspend", null);
  }

  function onExtendTrial() {
    const raw = window.prompt(`Extend trial for "${workspaceName}" by how many days? (1–365)`, "30");
    if (raw === null) return;
    const days = Number(raw.trim());
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      alert("Please enter a whole number between 1 and 365.");
      return;
    }
    void call("extend-trial", { days });
  }

  const disabled = isPending || busyAction !== null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {isSuspended ? (
        <button
          type="button"
          onClick={onUnsuspend}
          disabled={disabled}
          className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyAction === "unsuspend" ? "…" : "Unsuspend"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onSuspend}
          disabled={disabled}
          className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyAction === "suspend" ? "…" : "Suspend"}
        </button>
      )}
      <button
        type="button"
        onClick={onExtendTrial}
        disabled={disabled}
        className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busyAction === "extend-trial" ? "…" : "Extend trial"}
      </button>
    </div>
  );
}
