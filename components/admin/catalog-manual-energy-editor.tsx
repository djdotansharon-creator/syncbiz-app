"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bpmRangeLabelForManualEnergy } from "@/lib/catalog-manual-energy-bpm";

/** Stage 6.2A — manual energy 1–10; BPM band is derived display only. */
export function CatalogManualEnergyEditor({
  catalogItemId,
  initialManualEnergyRating,
}: {
  catalogItemId: string;
  initialManualEnergyRating: number | null;
}) {
  const router = useRouter();
  const normalizeIn = (v: number | null) =>
    v != null && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null;

  const [energy, setEnergy] = useState<number | null>(() => normalizeIn(initialManualEnergyRating));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setEnergy(normalizeIn(initialManualEnergyRating));
  }, [catalogItemId, initialManualEnergyRating]);

  const bpmHint = useMemo(() => bpmRangeLabelForManualEnergy(energy), [energy]);

  const save = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/platform/catalog-items/${catalogItemId}/manual-energy-rating`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualEnergyRating: energy }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(typeof j.error === "string" ? j.error : `Save failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [catalogItemId, energy, router]);

  return (
    <div className="space-y-3 rounded-lg border border-violet-900/45 border-l-4 border-l-violet-500/70 bg-violet-950/20 px-4 py-3 ring-1 ring-violet-800/25">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-200/95">Energy rating</p>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
          Manual music energy / tempo-feeling score <strong className="font-medium text-neutral-400">1–10</strong>. Separate from SyncBiz curation quality (0–5). BPM band below is{" "}
          <strong className="font-medium text-neutral-400">display-only</strong> — not used in DJ Creator or smart-search yet.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-violet-800/60 bg-violet-950/45 px-2 py-1 font-mono text-xs font-semibold tracking-tight text-violet-50">
          {energy != null ? `Energy ${energy}/10` : "Energy — unset"}
        </span>
        {bpmHint ? (
          <span className="text-[11px] text-neutral-400">
            Derived BPM: <span className="font-medium text-neutral-300">{bpmHint}</span>
          </span>
        ) : (
          <span className="text-[11px] text-neutral-600">Select 1–10 to show BPM hint, or clear.</span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label="Energy rating 1–10">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((step) => (
          <button
            key={step}
            type="button"
            title={bpmRangeLabelForManualEnergy(step) ?? String(step)}
            onClick={() => setEnergy(step)}
            className={`min-w-[2rem] rounded border px-2 py-1.5 font-mono text-[11px] font-semibold transition-colors ${
              energy === step
                ? "border-violet-500 bg-violet-950/60 text-violet-50 ring-1 ring-violet-500/40"
                : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800"
            }`}
          >
            {step}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setEnergy(null)}
        className="text-[11px] font-medium text-neutral-500 underline-offset-2 hover:text-violet-300 hover:underline"
      >
        Clear (unset)
      </button>

      {err ? (
        <p className="rounded border border-rose-900/60 bg-rose-950/35 px-3 py-2 text-xs text-rose-100">{err}</p>
      ) : null}

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded border border-violet-700 bg-violet-950/50 px-4 py-2 text-sm font-semibold text-violet-50 hover:bg-violet-900/55 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {saving ? "Saving…" : "Save energy rating"}
      </button>
    </div>
  );
}
