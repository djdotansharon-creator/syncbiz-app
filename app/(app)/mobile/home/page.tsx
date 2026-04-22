"use client";

import Link from "next/link";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileBrowseTile } from "@/components/mobile/mobile-browse-tile";
import { MobileSourceRow } from "@/components/mobile/mobile-source-row";
import { useMobileSources } from "@/lib/mobile-sources-context";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * Mobile Home: quick-access entry point.
 *
 * Layout mirrors the Spotify mobile home pattern from the reference screenshots:
 *   1. Page header with title + mode pill
 *   2. "Jump back in" — first 4 playlists, as a compact list
 *   3. "Browse" — 2x2 color tiles that route into the Library / Search flows
 *
 * All data comes from `MobileSourcesProvider`; this page does not fetch on its own.
 */
export default function MobileHomePage() {
  const { sources, status, error, removeSource } = useMobileSources();

  const playlists = sources.filter((s: UnifiedSource) => s.origin === "playlist").slice(0, 4);
  const hasAny = sources.length > 0;

  return (
    <>
      <MobilePageHeader
        title="Home"
        showModePill
        actions={
          <Link
            href="/mobile/search"
            aria-label="Search"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-300 hover:text-slate-100"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
          </Link>
        }
      />

      <div className="px-4 py-4 pb-8">
        {status === "loading" && !hasAny ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading library…</div>
        ) : status === "error" ? (
          <div className="py-8 text-center text-sm text-rose-400">{error}</div>
        ) : (
          <>
            <section className="mb-6">
              <h2 className="mb-3 text-base font-semibold tracking-tight text-slate-100">Jump back in</h2>
              {playlists.length === 0 ? (
                <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-5 text-center text-sm text-slate-400">
                  <p>No playlists yet.</p>
                  <Link
                    href="/mobile/search"
                    className="mt-2 inline-block text-sm font-medium text-sky-400 hover:underline"
                  >
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
                      editReturnTo="/mobile/home"
                      compact
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-base font-semibold tracking-tight text-slate-100">Browse</h2>
              <div className="grid grid-cols-2 gap-3">
                <MobileBrowseTile
                  label="Your Library"
                  href="/mobile/library"
                  gradient="from-sky-600 to-cyan-700"
                />
                <MobileBrowseTile
                  label="Search & Discover"
                  href="/mobile/search"
                  gradient="from-fuchsia-600 to-purple-700"
                />
                <MobileBrowseTile
                  label="Radio Stations"
                  href="/mobile/library?filter=radio"
                  gradient="from-rose-500 to-red-700"
                />
                <MobileBrowseTile
                  label="Remote Control"
                  href="/mobile/remote"
                  gradient="from-amber-500 to-orange-700"
                />
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
