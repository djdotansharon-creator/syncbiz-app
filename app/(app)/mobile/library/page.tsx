"use client";

import { useMemo } from "react";
import Link from "next/link";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileSourceRow } from "@/components/mobile/mobile-source-row";
import { useMobileSources } from "@/lib/mobile-sources-context";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * Mobile Library — playlists only.
 *
 * Radio is intentionally excluded from the mobile information architecture
 * (no tile, no filter, no deep-link flow). Desktop Radio remains untouched.
 */
export default function MobileLibraryPage() {
  const { sources, status, error, removeSource, reload } = useMobileSources();

  const playlists = useMemo<UnifiedSource[]>(
    () => sources.filter((s) => s.origin === "playlist"),
    [sources],
  );

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

      <div className="px-4 py-3 pb-8">
        {status === "loading" && playlists.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : status === "error" ? (
          <div className="py-8 text-center text-sm text-rose-400">{error}</div>
        ) : playlists.length === 0 ? (
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-400">
            <p className="mb-1">No playlists yet.</p>
            <Link href="/mobile/search" className="text-sm font-medium text-sky-400 hover:underline">
              Search to add one
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {playlists.map((source) => (
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
