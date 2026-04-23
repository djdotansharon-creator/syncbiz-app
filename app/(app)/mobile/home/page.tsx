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
                  subtitle="Playlists & tracks"
                  href="/mobile/library"
                  gradient="from-sky-600 to-cyan-700"
                  icon={<LibraryIcon />}
                />
                <MobileBrowseTile
                  label="Search"
                  subtitle="Add new sources"
                  href="/mobile/search"
                  gradient="from-fuchsia-600 to-purple-700"
                  icon={<SearchIcon />}
                />
                <MobileBrowseTile
                  label="Scheduling"
                  subtitle="Upcoming plays"
                  href="/mobile/scheduling"
                  gradient="from-emerald-600 to-teal-700"
                  icon={<CalendarIcon />}
                />
                <MobileBrowseTile
                  label="Remote"
                  subtitle="Control the player"
                  href="/mobile/remote"
                  gradient="from-amber-500 to-orange-700"
                  icon={<RemoteIcon />}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function LibraryIcon() {
  // Clean album sleeve + vinyl glyph — uniform stroke weight, no faded
  // lines. Matches the visual weight of the Calendar / Remote / Search
  // tile icons after the Home tile's rotate-[20deg] is applied.
  return (
    <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="16.5" cy="15" r="5.5" />
      <circle cx="16.5" cy="15" r="1" fill="currentColor" stroke="none" />
      <rect x="3.5" y="4.5" width="11" height="14" rx="1.6" />
      <path d="M6.5 9h5M6.5 12h3.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}

function RemoteIcon() {
  return (
    <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="6" y="3" width="12" height="18" rx="3" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 12h6M9 15h6M10 18h4" strokeLinecap="round" />
    </svg>
  );
}
