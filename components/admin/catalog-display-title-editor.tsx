"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** SUPER_ADMIN — curated CatalogItem.title only (source snapshot title is separate). */
export function CatalogDisplayTitleEditor({
  catalogItemId,
  initialTitle,
}: {
  catalogItemId: string;
  initialTitle: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setValue(initialTitle);
  }, [catalogItemId, initialTitle]);

  const save = useCallback(async () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setErr("Title cannot be empty.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/platform/catalog-items/${catalogItemId}/title`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
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
  }, [catalogItemId, value, router]);

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-300/95">
          Catalog display title
        </span>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
          This is the SyncBiz curated title. Source title stays in metadata snapshot.
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 w-full max-w-xl rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-base font-semibold leading-snug text-neutral-50"
          autoComplete="off"
        />
      </label>
      {err ? (
        <p className="rounded border border-rose-900/60 bg-rose-950/35 px-3 py-2 text-xs text-rose-100">{err}</p>
      ) : null}
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded border border-sky-700 bg-sky-950/45 px-4 py-2 text-sm font-semibold text-sky-50 hover:bg-sky-900/55 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {saving ? "Saving…" : "Save title"}
      </button>
    </div>
  );
}
