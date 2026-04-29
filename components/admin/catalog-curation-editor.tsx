"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const RATING_DETAIL: readonly { value: number; label: string }[] = [
  { value: 0, label: "Unrated" },
  { value: 1, label: "Weak / not recommended" },
  { value: 2, label: "Niche / use carefully" },
  { value: 3, label: "Good" },
  { value: 4, label: "Strong" },
  { value: 5, label: "Premium / highly recommended" },
];

/** SUPER_ADMIN catalog tagging — manual editorial score only (not views/likes/popularity). */
export function CatalogCurationEditor({
  catalogItemId,
  initialRating,
  initialNotes,
}: {
  catalogItemId: string;
  initialRating: number;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(() =>
    typeof initialRating === "number" && Number.isInteger(initialRating) && initialRating >= 0 && initialRating <= 5
      ? initialRating
      : 0,
  );
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const detailLabel = useMemo(() => {
    const row = RATING_DETAIL.find((r) => r.value === rating);
    return row?.label ?? "—";
  }, [rating]);

  useEffect(() => {
    const r =
      typeof initialRating === "number" && Number.isInteger(initialRating) && initialRating >= 0 && initialRating <= 5
        ? initialRating
        : 0;
    setRating(r);
    setNotes(initialNotes ?? "");
  }, [catalogItemId, initialRating, initialNotes]);

  const save = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/platform/catalog-items/${catalogItemId}/curation`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          curationRating: rating,
          curationNotes: notes.trim().length === 0 ? null : notes.trim(),
        }),
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
  }, [catalogItemId, notes, rating, router]);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">SyncBiz curation rating</p>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
          Manual editorial score for catalog quality —{" "}
          <strong className="font-medium text-neutral-400">not</strong> YouTube likes/views or automated popularity.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-amber-800/60 bg-amber-950/45 px-2 py-1 font-mono text-xs font-semibold tracking-tight text-amber-50">
          SYNC {rating}/5
        </span>
        <span className="text-[11px] text-neutral-400">{detailLabel}</span>
      </div>

      <div className="flex items-center gap-1.5" aria-label="Rating dots">
        {[1, 2, 3, 4, 5].map((step) => (
          <span
            key={step}
            className={`h-2 w-2 rounded-full ${
              rating >= step ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.35)]" : "bg-neutral-700"
            }`}
            aria-hidden
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {RATING_DETAIL.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            title={label}
            onClick={() => setRating(value)}
            className={`min-w-[2.25rem] rounded border px-2 py-1.5 font-mono text-[11px] font-semibold transition-colors ${
              rating === value
                ? "border-amber-500 bg-amber-950/60 text-amber-50 ring-1 ring-amber-500/40"
                : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-[11px] font-medium text-neutral-500">Curation notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Internal editorial notes…"
          className="mt-1 w-full max-w-xl rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600"
        />
      </label>

      {err ? (
        <p className="rounded border border-rose-900/60 bg-rose-950/35 px-3 py-2 text-xs text-rose-100">{err}</p>
      ) : null}

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded border border-amber-700 bg-amber-950/50 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-amber-900/55 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {saving ? "Saving…" : "Save rating"}
      </button>
    </div>
  );
}
