"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { CatalogAuditionBar } from "@/components/admin/catalog-item-taxonomy-editor";

/**
 * URL audition + source snapshot refresh — placed at the top of the catalog workbench item header.
 */
export function CatalogWorkbenchItemActions({
  catalogItemId,
  url,
  provider,
  videoId,
}: {
  catalogItemId: string;
  url: string;
  provider: string | null;
  videoId?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/platform/catalog-items/${catalogItemId}/source-metadata/refresh`, {
        method: "POST",
        credentials: "same-origin",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(typeof j.error === "string" ? j.error : `Refresh failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }, [catalogItemId, router]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <CatalogAuditionBar url={url} provider={provider} videoId={videoId} />
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="rounded border border-indigo-700 bg-indigo-950/55 px-2.5 py-1 text-[11px] font-semibold text-indigo-50 hover:bg-indigo-900/65 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? "Refreshing…" : "Refresh source metadata"}
        </button>
      </div>
      {err ? <p className="text-[11px] text-rose-300">{err}</p> : null}
    </div>
  );
}
