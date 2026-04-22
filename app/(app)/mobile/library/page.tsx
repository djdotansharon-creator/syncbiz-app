"use client";

import { useMemo, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileSourceRow } from "@/components/mobile/mobile-source-row";
import { useMobileSources } from "@/lib/mobile-sources-context";
import type { UnifiedSource } from "@/lib/source-types";

type Filter = "all" | "playlists" | "radio";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "playlists", label: "Playlists" },
  { id: "radio", label: "Radio" },
];

/**
 * Mobile Library — the user's saved playlists + radio stations.
 *
 * Structure follows the library reference screenshot:
 *   - pill filter row (horizontally scrollable, single-select)
 *   - sort control on the opposite side (recency-only for now)
 *   - 2-line list rows (`MobileSourceRow`) that respect Controller/Player mode via mobileRole
 *
 * The `?filter=` query param is read on mount so browse tiles on Home can deep-link
 * straight to "Radio" view. Changes to the filter push a shallow URL update so the back
 * button returns to the previous filter instead of the previous tab.
 */
export default function MobileLibraryPage() {
  const { sources, status, error, removeSource, reload } = useMobileSources();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilter = useMemo<Filter>(() => {
    const raw = searchParams.get("filter");
    if (raw === "playlists" || raw === "radio") return raw;
    return "all";
  }, [searchParams]);
  const [filter, setFilter] = useState<Filter>(initialFilter);

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  const applyFilter = (next: Filter) => {
    setFilter(next);
    const url = next === "all" ? "/mobile/library" : `/mobile/library?filter=${next}`;
    router.replace(url, { scroll: false });
  };

  const filtered = useMemo<UnifiedSource[]>(() => {
    const items = sources.filter((s) => s.origin === "playlist" || s.origin === "radio");
    if (filter === "playlists") return items.filter((s) => s.origin === "playlist");
    if (filter === "radio") return items.filter((s) => s.origin === "radio");
    return items;
  }, [sources, filter]);

  return (
    <>
      <MobilePageHeader
        title="Your Library"
        showModePill
        actions={
          <button
            type="button"
            onClick={reload}
            aria-label="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-300 hover:text-slate-100"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 21v-5h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        }
      />

      <div className="sticky top-[57px] z-20 border-b border-slate-800/60 bg-slate-950/95 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => applyFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors touch-manipulation ${
                filter === f.id
                  ? "border-slate-200/90 bg-slate-100 text-slate-950"
                  : "border-slate-700/70 bg-slate-900/60 text-slate-300 hover:bg-slate-800/80"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 pb-8">
        {status === "loading" && sources.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : status === "error" ? (
          <div className="py-8 text-center text-sm text-rose-400">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-400">
            <p className="mb-1">Nothing here yet.</p>
            <Link href="/mobile/search" className="text-sm font-medium text-sky-400 hover:underline">
              Search to add
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((source) => (
              <MobileSourceRow
                key={source.id}
                source={source}
                onRemove={removeSource}
                editReturnTo="/mobile/library"
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
