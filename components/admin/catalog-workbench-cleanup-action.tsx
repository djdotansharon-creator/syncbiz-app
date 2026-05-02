"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";

type ModalKind = "delete" | "remove" | "restore" | null;

/**
 * SUPER_ADMIN catalog lifecycle — hard-delete unused rows only; archive used rows from discovery without touching playlists.
 */
export function CatalogWorkbenchCleanupAction({
  catalogItemId,
  strictlyUnused,
  isArchived,
  distinctPlaylistCount,
  workspaceCount,
  usageSummaryCompact,
}: {
  catalogItemId: string;
  strictlyUnused: boolean;
  isArchived: boolean;
  distinctPlaylistCount: number;
  workspaceCount: number;
  usageSummaryCompact: string | null;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalKind>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const close = useCallback(() => {
    if (!busy) {
      setModal(null);
      setErr(null);
    }
  }, [busy]);

  const runDelete = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/platform/catalog-items/${catalogItemId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; summary?: string };
      if (res.status === 409) {
        const detail =
          typeof j.summary === "string" && j.summary.trim()
            ? j.summary
            : typeof j.error === "string"
              ? j.error
              : "Item is in use";
        setErr(detail);
        setBusy(false);
        return;
      }
      if (!res.ok) {
        throw new Error(typeof j.error === "string" ? j.error : `Delete failed (${res.status})`);
      }
      close();
      router.push("/admin/platform/catalog-tagging");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }, [catalogItemId, router, close]);

  const runArchive = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/platform/catalog-items/${catalogItemId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(typeof j.error === "string" ? j.error : `Archive failed (${res.status})`);
      }
      close();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setBusy(false);
    }
  }, [catalogItemId, router, close]);

  const runRestore = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/platform/catalog-items/${catalogItemId}/restore`, {
        method: "POST",
        credentials: "same-origin",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(typeof j.error === "string" ? j.error : `Restore failed (${res.status})`);
      }
      close();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }, [catalogItemId, router, close]);

  const deleteDisabledReason =
    !strictlyUnused && usageSummaryCompact?.trim()
      ? `Cannot delete — ${usageSummaryCompact}`
      : !strictlyUnused
        ? "Cannot delete — in use"
        : undefined;

  const overlay = (
    kind: ModalKind,
    title: string,
    body: ReactNode,
    confirmLabel: string,
    onConfirm: () => void | Promise<void>,
    tone: "rose" | "amber" | "sky",
  ) => {
    if (modal !== kind) return null;
    const btn =
      tone === "rose"
        ? "border-rose-700 bg-rose-900/75 hover:bg-rose-800"
        : tone === "amber"
          ? "border-amber-700 bg-amber-900/70 hover:bg-amber-800"
          : "border-sky-700 bg-sky-900/70 hover:bg-sky-800";
    return (
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="max-w-md rounded-lg border border-neutral-700 bg-neutral-950 p-5 shadow-xl shadow-black/40"
        >
          <h3 className="text-sm font-semibold text-neutral-50">{title}</h3>
          <div className="mt-3 text-sm leading-snug text-neutral-300">{body}</div>
          <p className="mt-2 font-mono text-[11px] text-neutral-500">{catalogItemId}</p>
          {err ? (
            <p className="mt-3 rounded border border-rose-900/55 bg-rose-950/35 px-3 py-2 text-xs text-rose-100">
              {err}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="rounded border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-800 disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onConfirm()}
              className={`rounded border px-3 py-2 text-xs font-semibold text-white disabled:opacity-45 ${btn}`}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-wrap items-start gap-2">
      {strictlyUnused ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setModal("delete")}
          className="rounded border border-rose-700 bg-rose-950/60 px-3 py-2 text-center text-xs font-semibold text-rose-50 hover:bg-rose-900/55 disabled:opacity-45"
        >
          Delete
        </button>
      ) : (
        <button
          type="button"
          disabled
          title={deleteDisabledReason}
          className="cursor-not-allowed rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-center text-xs font-semibold text-neutral-500 opacity-70"
        >
          Cannot delete — in use
        </button>
      )}

      {!strictlyUnused && !isArchived ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setModal("remove")}
          className="rounded border border-amber-700 bg-amber-950/55 px-3 py-2 text-xs font-semibold text-amber-50 hover:bg-amber-900/55 disabled:opacity-45"
        >
          Remove from catalog
        </button>
      ) : null}

      {isArchived ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setModal("restore")}
          className="rounded border border-sky-700 bg-sky-950/55 px-3 py-2 text-xs font-semibold text-sky-50 hover:bg-sky-900/55 disabled:opacity-45"
        >
          Restore to catalog
        </button>
      ) : null}

      {overlay(
        "delete",
        "Delete catalog item?",
        <p>This will delete this CatalogItem only if it is not used anywhere.</p>,
        "Delete permanently",
        runDelete,
        "rose",
      )}
      {overlay(
        "remove",
        "Remove from catalog?",
        <p>
          This item is used in{" "}
          <span className="font-semibold text-neutral-100">{distinctPlaylistCount}</span> playlist
          {distinctPlaylistCount === 1 ? "" : "s"} across{" "}
          <span className="font-semibold text-neutral-100">{workspaceCount}</span> workspace
          {workspaceCount === 1 ? "" : "s"}. Existing playlists keep the URL, but this item will be hidden from future
          catalog discovery.
        </p>,
        "Remove from catalog",
        runArchive,
        "amber",
      )}
      {overlay(
        "restore",
        "Restore to catalog?",
        <p>This row will appear again in discovery, smart search, and recommendation scans.</p>,
        "Restore",
        runRestore,
        "sky",
      )}
    </div>
  );
}
