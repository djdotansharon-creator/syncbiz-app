"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MobilePlayerBar } from "@/components/mobile-player-bar";
import { MobilePlayerBarLocal } from "@/components/mobile-player-bar-local";
import { MobileSearchBar } from "@/components/mobile-search-bar";
import { MobileSourceCard } from "@/components/mobile-source-card";
import { MobileSourceCardLocal } from "@/components/mobile-source-card-local";
import { StationControllerProvider, useStationController } from "@/lib/station-controller-context";
import { useMobileRole } from "@/lib/mobile-role-context";
import { fetchUnifiedSourcesWithFallback } from "@/lib/unified-sources-client";
import { resolveMobileUnifiedScope } from "@/lib/content-scope-resolution";
import type { ApiContentScope } from "@/lib/content-scope-filters";
import type { AccessType } from "@/lib/user-types";
import { usePlayback } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";

/** Optimistically add a newly discovered source to list and queue. Prevents "added but not playable" state. */
function useHandleAddSource(
  setSources: React.Dispatch<React.SetStateAction<UnifiedSource[]>>,
  setQueue: (sources: UnifiedSource[]) => void,
  queue: UnifiedSource[]
) {
  return useCallback(
    (source: UnifiedSource) => {
      setSources((prev) => {
        if (prev.some((s) => s.id === source.id)) return prev;
        return [source, ...prev];
      });
      const merged = [source, ...queue].filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i);
      setQueue(merged);
    },
    [setQueue, queue]
  );
}

/** Controller / Player selector – the ONLY source of truth for mobile mode. */
function MobileRoleSelector() {
  const { mobileRole, setMobileRole } = useMobileRole();
  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-slate-700/80 bg-slate-900/60 p-0.5"
      role="group"
      aria-label="Mobile mode"
    >
      <button
        type="button"
        onClick={() => setMobileRole("controller")}
        aria-pressed={mobileRole === "controller"}
        className={`rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all ${
          mobileRole === "controller"
            ? "bg-sky-500/25 text-sky-200 border border-sky-500/50"
            : "text-slate-500 hover:text-slate-300"
        }`}
      >
        Controller
      </button>
      <button
        type="button"
        onClick={() => setMobileRole("player")}
        aria-pressed={mobileRole === "player"}
        className={`rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all ${
          mobileRole === "player"
            ? "bg-amber-500/20 text-amber-200 border border-amber-500/50"
            : "text-slate-500 hover:text-slate-300"
        }`}
      >
        Player
      </button>
    </div>
  );
}

/** Controller mode: controls the desktop MASTER. Remote-control focused UI only. */
function MobileControllerContent() {
  const [sources, setSources] = useState<UnifiedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { setQueue } = usePlayback();
  const { devices, status, selectedDeviceId, sendPlaySource } = useStationController();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchUnifiedSourcesWithFallback({ scope: "branch" });
      const playlists = items.filter((s) => s.origin === "playlist");
      setSources(items);
      setQueue(playlists);
    } catch {
      setError("Failed to load playlists");
    } finally {
      setLoading(false);
    }
  }, [setQueue]);

  const handleRemove = useCallback((id: string, origin?: UnifiedSource["origin"]) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    if (origin === "playlist") {
      import("@/lib/unified-sources-client").then(({ removePlaylistFromLocal }) => removePlaylistFromLocal(id));
    } else if (origin === "radio") {
      import("@/lib/unified-sources-client").then(({ removeRadioFromLocal }) => removeRadioFromLocal(id));
    }
    load();
  }, [load]);

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
  const outputLabel = selectedDeviceId && selectedDevice
    ? (selectedDevice.mode === "MASTER" ? "Main Player" : `Player ${devices.findIndex((d) => d.id === selectedDeviceId) + 1}`)
    : null;

  return (
    <>
      <section className="border-b border-sky-800/40 bg-sky-950/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-300">
            Controller
          </span>
          {status === "disconnected" || status === "error" ? (
            <span className="text-xs text-slate-400">Connecting…</span>
          ) : devices.length === 0 ? (
            <span className="text-xs text-slate-400">
              No player. Open <Link href="/remote-player" className="text-sky-400 hover:underline">Remote Player</Link> on your computer.
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${statusColor}`}>
                {status}
              </span>
              {outputLabel ? (
                <span className="text-xs font-medium text-slate-200">→ {outputLabel}</span>
              ) : (
                <span className="text-xs text-slate-400">No primary player.</span>
              )}
            </div>
          )}
        </div>
      </section>

      <MobilePlayerBar />

      <section className="border-b border-slate-800/60 px-4 py-2">
        <MobileSearchBar
          sources={sources}
          onAdd={load}
          onPlay={sendPlaySource}
          onSendToPlayer={sendPlaySource}
          placeholder="Search library or discover playlists…"
          isControllerMode
          editReturnTo="/mobile"
        />
      </section>

      <main className="flex-1 overflow-y-auto px-4 py-3">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Send to remote
        </h2>
        {loading ? (
          <div className="py-6 text-center text-sm text-slate-500">Loading…</div>
        ) : error ? (
          <div className="py-6 text-center text-sm text-rose-400">{error}</div>
        ) : sources.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">
            No playlists. <Link href="/sources" className="text-sky-400 hover:underline">Add playlists</Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sources.filter((s) => s.origin === "playlist" || s.origin === "radio").map((source) => (
              <MobileSourceCard key={source.id} source={source} onRemove={handleRemove} editReturnTo="/mobile" />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

type MobilePlayerSection = "library" | "radio";

/** Player mode: plays locally on the phone. Dedicated player experience, distinct from Controller. */
function MobilePlayerContent() {
  const [sources, setSources] = useState<UnifiedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<MobilePlayerSection>("library");
  const [contentScope, setContentScope] = useState<ApiContentScope>("branch");
  const { setQueue, playSource, queue, replaceSource } = usePlayback();
  const handleAddSource = useHandleAddSource(setSources, setQueue, queue);

  const handleReplaceSource = useCallback(
    (tempId: string, real: UnifiedSource) => {
      setSources((prev) => prev.map((s) => (s.id === tempId ? real : s)));
      replaceSource(tempId, real);
    },
    [replaceSource]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await fetch("/api/auth/me", { credentials: "include" }).then((r) => r.json());
      const accessType = (me?.accessType === "OWNER" || me?.accessType === "BRANCH_USER"
        ? me.accessType
        : "BRANCH_USER") as AccessType;
      const scope = resolveMobileUnifiedScope(accessType, "player");
      setContentScope(scope);
      const items = await fetchUnifiedSourcesWithFallback({ scope });
      const forQueue = items.filter((s) => s.origin === "playlist" || s.origin === "radio");
      setSources(items);
      setQueue(forQueue);
    } catch {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [setQueue]);

  const handleRemove = useCallback((id: string, origin?: UnifiedSource["origin"]) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    if (origin === "playlist") {
      import("@/lib/unified-sources-client").then(({ removePlaylistFromLocal }) => removePlaylistFromLocal(id));
    } else if (origin === "radio") {
      import("@/lib/unified-sources-client").then(({ removeRadioFromLocal }) => removeRadioFromLocal(id));
    }
    load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <section className="border-b border-amber-800/40 bg-amber-950/20 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-200">
            Player
          </span>
          <span className="text-[10px] text-slate-400">Playing on this device</span>
        </div>
      </section>

      <div className="border-b border-slate-800/60 bg-slate-900/20">
        <MobilePlayerBarLocal />
      </div>

      <section className="border-b border-slate-800/60 bg-slate-950/50 px-4 py-3">
        <MobileSearchBar
          sources={sources}
          onAdd={handleAddSource}
          onPlay={playSource}
          onSendToPlayer={playSource}
          onReplaceSource={handleReplaceSource}
          placeholder="Search library or discover playlists…"
          isControllerMode={false}
          editReturnTo="/mobile"
          unifiedContentScope={contentScope}
        />
      </section>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 flex items-center gap-2 border-b border-slate-800/60 bg-slate-950/98 px-4 py-3 backdrop-blur-sm">
          <div
            className="inline-flex shrink-0 rounded-lg border border-slate-700/80 bg-slate-900/60 p-0.5"
            role="group"
            aria-label="Player sections"
          >
            <button
              type="button"
              onClick={() => setSection("library")}
              aria-pressed={section === "library"}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition touch-manipulation ${
                section === "library"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Library
            </button>
            <button
              type="button"
              onClick={() => setSection("radio")}
              aria-pressed={section === "radio"}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition touch-manipulation ${
                section === "radio"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Radio
            </button>
          </div>
        </div>
        {loading ? (
          <div className="py-6 text-center text-sm text-slate-500">Loading…</div>
        ) : error ? (
          <div className="py-6 text-center text-sm text-rose-400">{error}</div>
        ) : section === "library" ? (
          (() => {
            const lib = sources.filter((s) => s.origin === "playlist");
            return lib.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">
                No playlists. Search above to add.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {lib.map((source) => (
                  <MobileSourceCardLocal key={source.id} source={source} onRemove={handleRemove} editReturnTo="/mobile" />
                ))}
              </div>
            );
          })()
        ) : (
          (() => {
            const radios = sources.filter((s) => s.origin === "radio");
            return radios.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">
                No radio stations. Search above to add.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {radios.map((source) => (
                  <MobileSourceCardLocal key={source.id} source={source} onRemove={handleRemove} editReturnTo="/mobile" />
                ))}
              </div>
            );
          })()
        )}
      </main>
    </>
  );
}

function MobileRemoteContent() {
  const { mobileRole } = useMobileRole();

  return (
    <div className="flex min-h-screen flex-col bg-slate-950">
      <header className="sticky top-0 z-40 shrink-0 border-b border-slate-800/60 bg-slate-950/98 backdrop-blur-sm">
        <div className="flex min-w-0 items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <Link href="/library" className="flex shrink-0 items-center gap-1.5">
              <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                mobileRole === "player" ? "bg-amber-500/20 text-amber-400" : "bg-sky-500/20 text-sky-400"
              }`}>
                SB
              </span>
              <span className="text-xs font-semibold text-slate-100 truncate">Remote</span>
            </Link>
            <MobileRoleSelector />
          </div>
        </div>
      </header>

      {mobileRole === "controller" ? (
        <StationControllerProvider>
          <MobileControllerContent />
        </StationControllerProvider>
      ) : (
        <MobilePlayerContent />
      )}
    </div>
  );
}

export default function MobileRemotePage() {
  return <MobileRemoteContent />;
}
