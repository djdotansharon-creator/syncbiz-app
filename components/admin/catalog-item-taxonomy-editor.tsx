"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TaxonomyTagRow = {
  id: string;
  slug: string;
  category: string;
  labelEn: string;
  labelHe: string;
  status: string;
};

type LinkRow = {
  id: string;
  taxonomyTagId: string;
  taxonomyTag: TaxonomyTagRow;
};

/**
 * SUPER_ADMIN-only: add/remove manual links between a global CatalogItem and ACTIVE dictionary tags.
 */
export function CatalogItemTaxonomyEditor({
  catalogItemId,
}: {
  catalogItemId: string | null;
}) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [dictionary, setDictionary] = useState<TaxonomyTagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pickTagId, setPickTagId] = useState("");
  /** After first successful load, avoid swapping the whole panel for a spinner on refresh — prevents flaky controlled `<select>` state and perceived “single tag only”. */
  const hasLoadedOnceRef = useRef(false);
  const lastCatalogItemIdRef = useRef<string | null>(null);

  const base = catalogItemId
    ? `/api/admin/platform/catalog-items/${catalogItemId}/taxonomy-tags`
    : "";

  const load = useCallback(async () => {
    if (!catalogItemId || !base) {
      setLinks([]);
      setDictionary([]);
      setLoading(false);
      setErr(null);
      return;
    }
    setErr(null);
    const blockingSpinner = !hasLoadedOnceRef.current;
    if (blockingSpinner) setLoading(true);
    try {
      const fetchOpts: RequestInit = {
        credentials: "same-origin",
        cache: "no-store",
      };
      const [lr, dr] = await Promise.all([
        fetch(base, fetchOpts),
        fetch("/api/admin/platform/music-taxonomy/tags?status=ACTIVE", fetchOpts),
      ]);
      if (!lr.ok) {
        const j = await lr.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : `Load links failed (${lr.status})`);
      }
      if (!dr.ok) {
        const j = await dr.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Load dictionary failed (${dr.status})`,
        );
      }
      const lj = (await lr.json()) as { links: LinkRow[] };
      const dj = (await dr.json()) as { tags: TaxonomyTagRow[] };
      setLinks(lj.links ?? []);
      const rawTags = (dj.tags ?? []).filter((t) => t.status === "ACTIVE");
      const dedup = new Map<string, TaxonomyTagRow>();
      for (const t of rawTags) dedup.set(t.id, t);
      setDictionary([...dedup.values()]);
      hasLoadedOnceRef.current = true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [base, catalogItemId]);

  useEffect(() => {
    if (!catalogItemId) {
      setLoading(false);
      setLinks([]);
      setDictionary([]);
      setPickTagId("");
      setErr(null);
      hasLoadedOnceRef.current = false;
      lastCatalogItemIdRef.current = null;
      return;
    }
    if (lastCatalogItemIdRef.current !== catalogItemId) {
      lastCatalogItemIdRef.current = catalogItemId;
      hasLoadedOnceRef.current = false;
      setLinks([]);
      setDictionary([]);
      setPickTagId("");
    }
    void load();
  }, [catalogItemId, load]);

  const linkedIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of links) {
      if (l.taxonomyTagId) s.add(l.taxonomyTagId);
      if (l.taxonomyTag?.id) s.add(l.taxonomyTag.id);
    }
    return s;
  }, [links]);

  const addOptions = useMemo(() => {
    return dictionary
      .filter((t) => !linkedIds.has(t.id))
      .sort((a, b) =>
        a.category === b.category ? a.labelEn.localeCompare(b.labelEn) : a.category.localeCompare(b.category),
      );
  }, [dictionary, linkedIds]);

  async function addTag() {
    if (!catalogItemId || !pickTagId) return;
    setErr(null);
    const res = await fetch(base, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taxonomyTagId: pickTagId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : `Add failed (${res.status})`);
      return;
    }
    setPickTagId("");
    await load();
  }

  async function removeTag(taxonomyTagId: string) {
    setErr(null);
    const url = `${base}?taxonomyTagId=${encodeURIComponent(taxonomyTagId)}`;
    const res = await fetch(url, { method: "DELETE", credentials: "same-origin", cache: "no-store" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : `Remove failed (${res.status})`);
      return;
    }
    await load();
  }

  if (!catalogItemId) {
    return (
      <div className="space-y-4 rounded-md border border-neutral-800 bg-neutral-950/60 p-4 opacity-90">
        <p className="rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-100/95">
          Select a catalog item first.
        </p>

        <div>
          <h3 className="text-sm font-medium text-neutral-500">Assigned tags</h3>
          <p className="mt-2 text-sm text-neutral-600">Choose a row in the search results below.</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-xs text-neutral-600">
            Add ACTIVE taxonomy tag
            <select
              disabled
              className="cursor-not-allowed rounded border border-neutral-800 bg-neutral-900 px-2 py-2 text-sm text-neutral-500"
              value=""
            >
              <option value="">Choose tag…</option>
            </select>
          </label>
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-500"
          >
            Add tag
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading taxonomy tags…</p>;
  }

  return (
    <div className="space-y-4 rounded-md border border-neutral-800 bg-neutral-950/60 p-4">
      {err ? (
        <p className="rounded border border-rose-900/80 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {err}
        </p>
      ) : null}

      <div>
        <h3 className="text-sm font-medium text-neutral-200">Assigned tags</h3>
        {links.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No taxonomy tags yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {links.map((row) => (
              <li
                key={row.id}
                className="inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-200"
              >
                <span className="font-mono text-neutral-400">{row.taxonomyTag.slug}</span>
                <span>{row.taxonomyTag.labelEn}</span>
                <button
                  type="button"
                  className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-rose-300 hover:bg-neutral-700"
                  onClick={() => void removeTag(row.taxonomyTagId)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-xs text-neutral-500">
          Add ACTIVE taxonomy tag
          <select
            value={pickTagId}
            onChange={(e) => setPickTagId(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
          >
            <option value="">Choose tag…</option>
            {addOptions.map((t) => (
              <option key={t.id} value={t.id}>
                [{t.category}] {t.labelEn} ({t.slug})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!pickTagId}
          className="rounded border border-sky-700 bg-sky-900/40 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-900/60 disabled:opacity-40"
          onClick={() => void addTag()}
        >
          Add tag
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        This tag will be added to the selected catalog item above.
      </p>
    </div>
  );
}
