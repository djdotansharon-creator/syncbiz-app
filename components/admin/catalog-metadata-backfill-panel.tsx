"use client";

import { useState } from "react";

export function CatalogMetadataBackfillPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function runBackfill() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/platform/catalog-items/backfill-metadata", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        attempted?: number;
        error?: string;
        note?: string;
      };
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP ${res.status}`);
      setMsg(`Processed ${j.attempted ?? 0} catalog row(s). ${j.note ?? ""}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-amber-900/45 bg-amber-950/15 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/95">
        Legacy metadata backfill (admin)
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
        Runs up to <strong className="font-medium text-neutral-400">20</strong> YouTube catalog rows whose{" "}
        <strong className="font-medium text-neutral-400">latest snapshot is not SUCCESS/PARTIAL</strong> (missing or FAILED).
        Sequential refresh — bounded job, not a full-catalog sweep.
      </p>
      <button
        type="button"
        disabled={busy}
        className="mt-3 rounded border border-amber-700/70 bg-amber-950/40 px-3 py-2 text-xs font-semibold text-amber-50 hover:bg-amber-900/55 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => void runBackfill()}
      >
        {busy ? "Running…" : "Backfill missing metadata (batch)"}
      </button>
      {msg ? <p className="mt-2 text-[11px] text-neutral-400">{msg}</p> : null}
    </section>
  );
}
