"use client";

/**
 * Per-row action menu for `/admin/platform`.
 *
 * Suspend / Unsuspend / Extend trial: centered modals (no `alert` / `prompt` /
 * `confirm`). Successful writes show a short toast and `router.refresh()`.
 * API paths and request bodies are unchanged from the native-dialog era except
 * unsuspend may include optional `reason` (stored in audit `metadata.adminNote`).
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState, useTransition } from "react";

type Status = "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | null | undefined;

type ModalKind = "suspend" | "unsuspend" | "extend" | null;

type Props = {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  ownerEmail: string;
  status: Status;
  hasEntitlement: boolean;
  /** Display strings from the server (avoid Date serialization issues). */
  trialEndsAtLabel: string;
  trialEndsAtRelative: string;
  /** ISO string for the current `trialEndsAt` (or null) — used to preview new end client-side. */
  trialEndsAtIso: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mirrors `extend-trial` route: base = max(now, current trial end) if any. */
function previewNewTrialEndsAt(trialEndsAtIso: string | null, days: number): Date {
  const now = Date.now();
  const t = trialEndsAtIso ? new Date(trialEndsAtIso).getTime() : Number.NaN;
  const baseMs = !Number.isNaN(t) && t > now ? t : now;
  return new Date(baseMs + days * DAY_MS);
}

function formatUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function statusClass(status: string | undefined) {
  switch (status) {
    case "TRIALING":
      return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
    case "PAST_DUE":
      return "bg-orange-500/15 text-orange-300 ring-orange-500/30";
    case "SUSPENDED":
      return "bg-rose-500/15 text-rose-300 ring-rose-500/30";
    case "CANCELLED":
      return "bg-neutral-500/15 text-neutral-300 ring-neutral-500/30";
    default:
      return "bg-neutral-500/15 text-neutral-400 ring-neutral-500/30";
  }
}

export default function WorkspaceActions({
  workspaceId,
  workspaceName,
  workspaceSlug,
  ownerEmail,
  status,
  hasEntitlement,
  trialEndsAtLabel,
  trialEndsAtRelative,
  trialEndsAtIso,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const titleId = useId();

  const [activeModal, setActiveModal] = useState<ModalKind>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [suspendReason, setSuspendReason] = useState("");
  const [unsuspendReason, setUnsuspendReason] = useState("");
  const [extendDays, setExtendDays] = useState("30");

  const openModal = (kind: Exclude<ModalKind, null>) => {
    setError(null);
    if (kind === "extend") setExtendDays("30");
    if (kind === "suspend") setSuspendReason("");
    if (kind === "unsuspend") setUnsuspendReason("");
    setActiveModal(kind);
  };

  const closeModal = useCallback(() => {
    if (busyAction !== null) return;
    setActiveModal(null);
    setError(null);
  }, [busyAction]);

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

  const extendDaysNum = Number.parseInt(extendDays, 10);
  const extendValid =
    Number.isInteger(extendDaysNum) && extendDaysNum >= 1 && extendDaysNum <= 365;

  const previewNewEnd = useMemo(() => {
    if (!extendValid) return null;
    return previewNewTrialEndsAt(trialEndsAtIso, extendDaysNum);
  }, [extendValid, trialEndsAtIso, extendDaysNum]);

  if (!hasEntitlement) {
    return <span className="text-[11px] text-amber-400">backfill needed</span>;
  }

  const isSuspended = status === "SUSPENDED";
  const disabled = busyAction !== null || activeModal !== null;

  async function call(
    action: "suspend" | "unsuspend" | "extend-trial",
    body: Record<string, unknown> | null,
    successMessage: string,
  ) {
    setBusyAction(action);
    setError(null);
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
      setActiveModal(null);
      setSuspendReason("");
      setUnsuspendReason("");
      setError(null);
      setToast(successMessage);
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  function onSubmitSuspend() {
    void call(
      "suspend",
      { reason: suspendReason.trim() || null },
      `Suspended “${workspaceName}”.`,
    );
  }

  function onSubmitUnsuspend() {
    void call(
      "unsuspend",
      { reason: unsuspendReason.trim() || null },
      `Unsuspended “${workspaceName}”.`,
    );
  }

  async function onSubmitExtend() {
    if (!extendValid) return;
    setBusyAction("extend-trial");
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/platform/workspaces/${encodeURIComponent(workspaceId)}/extend-trial`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days: extendDaysNum }),
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
      let toastText = `Trial extended for “${workspaceName}”.`;
      if (
        typeof data === "object" &&
        data !== null &&
        "entitlement" in data &&
        (data as { entitlement?: { trialEndsAt?: unknown } }).entitlement &&
        typeof (data as { entitlement: { trialEndsAt?: unknown } }).entitlement.trialEndsAt ===
          "string"
      ) {
        const iso = (data as { entitlement: { trialEndsAt: string } }).entitlement.trialEndsAt;
        const parsed = new Date(iso);
        if (!Number.isNaN(parsed.getTime())) {
          toastText = `Trial extended for “${workspaceName}”. New end: ${formatUtcDate(parsed)} (UTC).`;
        }
      }
      setActiveModal(null);
      setError(null);
      setToast(toastText);
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {isSuspended ? (
        <button
          type="button"
          onClick={() => openModal("unsuspend")}
          disabled={disabled}
          className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Unsuspend
        </button>
      ) : (
        <button
          type="button"
          onClick={() => openModal("suspend")}
          disabled={disabled}
          className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Suspend
        </button>
      )}
      <button
        type="button"
        onClick={() => openModal("extend")}
        disabled={disabled}
        className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Extend trial
      </button>

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
            {activeModal === "suspend" ? (
              <>
                <h2 id={titleId} className="text-base font-semibold text-neutral-100">
                  Suspend workspace
                </h2>
                <dl className="mt-3 space-y-1 text-sm text-neutral-300">
                  <div>
                    <span className="text-neutral-500">Name: </span>
                    {workspaceName}
                  </div>
                  <div>
                    <span className="text-neutral-500">Slug: </span>
                    <span className="font-mono text-[12px]">{workspaceSlug}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500">Owner: </span>
                    {ownerEmail}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-neutral-500">Status: </span>
                    {status ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusClass(
                          String(status),
                        )}`}
                      >
                        {status}
                      </span>
                    ) : (
                      "—"
                    )}
                  </div>
                </dl>
                <label className="mt-4 block text-xs font-medium text-neutral-400">
                  Reason <span className="text-neutral-600">(optional)</span>
                </label>
                <textarea
                  className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600"
                  rows={2}
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Visible in the audit log"
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
                    onClick={closeModal}
                    disabled={busyAction !== null}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded border border-rose-500/40 bg-rose-600/20 px-3 py-1.5 text-sm font-medium text-rose-100 hover:bg-rose-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={onSubmitSuspend}
                    disabled={busyAction !== null}
                  >
                    {busyAction === "suspend" ? "Working…" : "Suspend"}
                  </button>
                </div>
              </>
            ) : null}

            {activeModal === "unsuspend" ? (
              <>
                <h2 id={titleId} className="text-base font-semibold text-neutral-100">
                  Unsuspend workspace
                </h2>
                <dl className="mt-3 space-y-1 text-sm text-neutral-300">
                  <div>
                    <span className="text-neutral-500">Name: </span>
                    {workspaceName}
                  </div>
                  <div>
                    <span className="text-neutral-500">Slug: </span>
                    <span className="font-mono text-[12px]">{workspaceSlug}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-neutral-500">Status: </span>
                    {status ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusClass(
                          String(status),
                        )}`}
                      >
                        {status}
                      </span>
                    ) : (
                      "—"
                    )}
                  </div>
                </dl>
                <p className="mt-2 text-xs text-neutral-500">
                  Workspace will return to TRIALING (if the trial is still active) or ACTIVE.
                </p>
                <label className="mt-3 block text-xs font-medium text-neutral-400">
                  Reason <span className="text-neutral-600">(optional)</span>
                </label>
                <textarea
                  className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600"
                  rows={2}
                  value={unsuspendReason}
                  onChange={(e) => setUnsuspendReason(e.target.value)}
                  placeholder="Note for the audit log"
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
                    onClick={closeModal}
                    disabled={busyAction !== null}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded border border-emerald-500/40 bg-emerald-600/20 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={onSubmitUnsuspend}
                    disabled={busyAction !== null}
                  >
                    {busyAction === "unsuspend" ? "Working…" : "Unsuspend"}
                  </button>
                </div>
              </>
            ) : null}

            {activeModal === "extend" ? (
              <>
                <h2 id={titleId} className="text-base font-semibold text-neutral-100">
                  Extend trial
                </h2>
                <p className="mt-0.5 text-sm text-neutral-400">{workspaceName}</p>
                <dl className="mt-4 space-y-3 text-sm text-neutral-300">
                  <div className="rounded border border-neutral-800 bg-neutral-900/50 p-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                      Current trial end
                    </dt>
                    <dd className="mt-1 text-neutral-100">
                      {trialEndsAtIso ? (
                        <>
                          <span className="font-mono">{trialEndsAtLabel}</span>{" "}
                          <span className="text-neutral-500">(UTC date)</span>
                          {trialEndsAtRelative ? (
                            <div className="text-[12px] text-neutral-500">{trialEndsAtRelative}</div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-neutral-400">Not set (extension starts from today)</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium uppercase tracking-wide text-neutral-500" htmlFor="extend-days">
                      Extend by (days, 1–365)
                    </label>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <input
                        id="extend-days"
                        type="number"
                        min={1}
                        max={365}
                        className="w-full max-w-[120px] rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 font-mono text-sm text-neutral-200"
                        value={extendDays}
                        onChange={(e) => setExtendDays(e.target.value)}
                      />
                      {extendValid ? (
                        <span className="text-neutral-400">
                          = <span className="text-neutral-200">{extendDaysNum}</span> day
                          {extendDaysNum === 1 ? "" : "s"} added
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded border border-amber-500/25 bg-amber-950/20 p-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-amber-200/80">
                      Preview: new trial end
                    </dt>
                    <dd className="mt-1 font-mono text-base text-amber-100">
                      {extendValid && previewNewEnd
                        ? `${formatUtcDate(previewNewEnd)} (UTC)`
                        : "—"}
                    </dd>
                    <p className="mt-1.5 text-[11px] leading-snug text-neutral-500">
                      Same as the server: the new date is the current trial end (or now if lapsed
                      / missing) plus the days you enter.
                    </p>
                  </div>
                </dl>
                {error ? (
                  <p
                    className="mt-3 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200"
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
                    disabled={busyAction !== null}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded border border-amber-500/40 bg-amber-600/20 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      void onSubmitExtend();
                    }}
                    disabled={busyAction !== null || !extendValid}
                  >
                    {busyAction === "extend-trial" ? "Working…" : "Extend trial"}
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
