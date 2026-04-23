"use client";

import Link from "next/link";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileBrowseTile } from "@/components/mobile/mobile-browse-tile";
import { MobileSourceRow } from "@/components/mobile/mobile-source-row";
import { MobileMiniPlayer } from "@/components/mobile/mobile-mini-player";
import { useMobileNowPlaying } from "@/lib/mobile-now-playing-context";
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
  const { openNowPlaying } = useMobileNowPlaying();

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

      {/* Now Playing hero — moved to the TOP of Home as part of the page
          design. On every other tab the mini-player stays pinned above the
          bottom nav; on Home it lives here so the current/next track is the
          first thing the user sees. See `MobileLayout` for the pathname
          check that hides the pinned dock on this route. */}
      <div className="px-4 pt-3">
        <MobileMiniPlayer onOpen={openNowPlaying} variant="top-card" />
      </div>

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
  return (
    <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M5 4v16M10 4v16M16 5l4 14" strokeLinecap="round" />
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
