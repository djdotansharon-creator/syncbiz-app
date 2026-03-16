"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MobilePlayerBar } from "@/components/mobile-player-bar";
import { MobileSourceCard } from "@/components/mobile-source-card";
import { StationControllerProvider, useStationController } from "@/lib/station-controller-context";
import { fetchUnifiedSourcesWithFallback } from "@/lib/unified-sources-client";
import { usePlayback } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";

function searchLocal(sources: UnifiedSource[], query: string): UnifiedSource[] {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return sources;
  return sources.filter((s) => {
    if (s.title.toLowerCase().includes(q)) return true;
    if (s.genre?.toLowerCase().includes(q)) return true;
    return false;
  });
}

function MobileRemoteContent() {
  const [playlists, setPlaylists] = useState<UnifiedSource[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { setQueue } = usePlayback();
  const { devices, status, selectedDeviceId } = useStationController();
  // C: selectedDeviceId = masterDeviceId. Commands always target current MASTER. No manual selection.
  const filteredPlaylists = searchQuery.trim().length >= 2 ? searchLocal(playlists, searchQuery) : playlists;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchUnifiedSourcesWithFallback();
      const filtered = items.filter((s) => s.origin === "playlist");
      setPlaylists(filtered);
      setQueue(filtered);
    } catch {
      setError("Failed to load playlists");
    } finally {
      setLoading(false);
    }
  }, [setQueue]);

  useEffect(() => {
    load();
  }, [load]);

  const statusColor =
    status === "connected"
      ? "bg-emerald-500/20 text-emerald-400"
      : status === "connecting"
        ? "bg-amber-500/20 text-amber-400"
        : "bg-slate-500/20 text-slate-400";

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const isMaster = selectedDevice?.mode === "MASTER";

  /** Human-readable output label – never expose raw device IDs */
  const outputLabel = selectedDeviceId && selectedDevice
    ? (isMaster ? "Main Player" : `Player ${devices.findIndex((d) => d.id === selectedDeviceId) + 1}`)
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950">
      {/* Compact header */}
      <header className="sticky top-0 z-40 flex flex-col border-b border-slate-800/60 bg-slate-950/98 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/library" className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sm font-semibold text-sky-400">
              SB
            </span>
            <span className="text-sm font-semibold text-slate-100">Remote</span>
          </Link>
          <Link
            href="/library"
            aria-label="Open full app"
            title="Open full app"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-600/50 bg-slate-800/60 text-slate-400 transition-all hover:border-sky-500/40 hover:bg-sky-500/15 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
            </svg>
          </Link>
        </div>
      </header>

      {/* Output device – clean human-readable label, MASTER as badge */}
      <section className="border-b border-slate-800/60 bg-slate-900/30 px-4 py-3">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Output
        </h2>
        {status === "disconnected" || status === "error" ? (
          <p className="text-xs text-slate-400">
            Connecting… Ensure both devices are on the same network.
          </p>
        ) : devices.length === 0 ? (
          <p className="text-xs text-slate-400">
            No player available. Open SyncBiz on your computer and go to{" "}
            <Link href="/remote-player" className="text-sky-400 hover:underline">
              Remote Player
            </Link>{" "}
            to make it available.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor}`}>
              {status}
            </span>
            {outputLabel ? (
              <>
                <span className="text-sm font-medium text-slate-200">
                  Controlling: {outputLabel}
                </span>
                {isMaster && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300 ring-1 ring-red-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_4px_rgba(239,68,68,0.6)]" />
                    MASTER
                  </span>
                )}
              </>
            ) : (
              <span className="text-sm text-slate-400">
                No MASTER. Open Remote Player on a device and switch to MASTER.
              </span>
            )}
          </div>
        )}
      </section>

      {/* Now Playing + Transport */}
      <MobilePlayerBar />

      {/* Search bar */}
      <section className="border-b border-slate-800/60 px-4 py-3">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search library…"
          aria-label="Search library"
          className="w-full rounded-xl border border-slate-700/80 bg-slate-900/80 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
        />
      </section>

      {/* Playlist list */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Library
        </h2>
        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-rose-400">{error}</div>
        ) : playlists.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            No playlists yet.{" "}
            <Link href="/sources" className="text-sky-400 hover:underline">
              Add playlists
            </Link>
          </div>
        ) : filteredPlaylists.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            No results for &quot;{searchQuery}&quot;
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredPlaylists.map((source) => (
              <MobileSourceCard key={source.id} source={source} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function MobileRemotePage() {
  return (
    <StationControllerProvider>
      <MobileRemoteContent />
    </StationControllerProvider>
  );
}
