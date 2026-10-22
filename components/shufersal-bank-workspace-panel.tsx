"use client";

/**
 * Shufersal Bank — center-monitor panel for the Shufersal pilot demo bank. SEPARATE from the existing
 * Royalty-Free Music bank (royalty-free-music-workspace-panel.tsx) — this file does not touch it.
 *
 * Stream-only: tracks play through the EXISTING chain — ephemeral playlist of `stream-url` items pointing
 * at `/api/media/<logicalId>` → routed play (CONTROL→MASTER) → AudioPlayer → PlaybackOrchestrator → MPV.
 * The MASTER appends its media-session token at play time (getPlayUrl); the token is never stored here.
 *
 * Gated by NEXT_PUBLIC_SHUFERSAL_BANK_ENABLED (default OFF) — the launcher + this panel are absent in
 * production until the flag is turned on. No playback / MASTER / WS logic lives here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayback } from "@/lib/playback-provider";
import { useDevicePlayer } from "@/lib/device-player-context";
import { subscribeMediaSession, hasMediaSessionToken } from "@/lib/media/media-session";
import { EPHEMERAL_LOCAL_PLAYLIST_PREFIX } from "@/lib/local-playlist-artwork";
import { formatDuration } from "@/lib/format-utils";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import { SHUFERSAL_DEMO_BANK, SHUFERSAL_DEMO_TRACKS } from "@/lib/music-bank/shufersal-demo-catalog";
import type { MusicBankSampleTrack } from "@/lib/music-bank/catalog-types";

function PlayIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>;
}

function totalDuration(tracks: MusicBankSampleTrack[]): number | null {
  const known = tracks.filter((t) => typeof t.durationSeconds === "number");
  if (known.length === 0) return null;
  return known.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
}

export function ShufersalBankWorkspacePanel({ onClose }: { onClose: () => void }) {
  const { playSource } = usePlayback();
  const dp = useDevicePlayer();
  const deviceMode = dp?.deviceMode;
  const playSourceOrSend = dp?.playSourceOrSend ?? playSource;

  // Streaming readiness: a CONTROL just routes a token-free URL to the MASTER (which holds the token);
  // a MASTER must hold the media-session token itself (minted by <MasterMediaSession/>).
  const [hasMasterToken, setHasMasterToken] = useState(false);
  useEffect(() => {
    setHasMasterToken(hasMediaSessionToken());
    return subscribeMediaSession(() => setHasMasterToken(hasMediaSessionToken()));
  }, []);
  const streamReady = deviceMode === "CONTROL" ? true : hasMasterToken;

  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const tracks = SHUFERSAL_DEMO_TRACKS;
  const total = useMemo(() => totalDuration(tracks), [tracks]);

  const buildSource = useCallback(
    (list: MusicBankSampleTrack[]): UnifiedSource | null => {
      if (!streamReady) return null;
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const plTracks: PlaylistTrack[] = list.map((t) => ({
        id: t.id,
        name: t.title,
        type: "stream-url" as const,
        url: `${base}/api/media/${encodeURIComponent(t.id)}`,
      }));
      if (plTracks.length === 0) return null;
      const first = plTracks[0].url;
      const playlist: Playlist = {
        id: `${EPHEMERAL_LOCAL_PLAYLIST_PREFIX}shufersal-bank`,
        name: `${SHUFERSAL_DEMO_BANK.bankName} — Samples`,
        genre: SHUFERSAL_DEMO_BANK.bankName,
        type: "stream-url",
        url: first,
        thumbnail: "",
        createdAt: new Date().toISOString(),
        tracks: plTracks,
        order: plTracks.map((t) => t.id),
      };
      return { id: playlist.id, title: playlist.name, genre: SHUFERSAL_DEMO_BANK.bankName, cover: null, type: "stream-url", url: first, origin: "playlist", playlist };
    },
    [streamReady],
  );

  const playFrom = useCallback(
    (startId: string | null) => {
      const source = buildSource(tracks);
      if (!source) return;
      const idx = startId ? tracks.findIndex((t) => t.id === startId) : 0;
      playSourceOrSend(source, idx >= 0 ? idx : 0);
      setNowPlaying(startId ?? tracks[0]?.id ?? null);
    },
    [buildSource, playSourceOrSend, tracks],
  );

  const hint = streamReady ? null : "Preparing streaming…";

  return (
    <div className="sb-anim-rise flex max-h-[min(85vh,760px)] w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0f] text-[#f5f5f7]">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#0a84ff]/15 text-[#7db8ff]"><PlayIcon className="h-3 w-3" /></span>
          <h2 className="text-sm font-semibold tracking-tight">{SHUFERSAL_DEMO_BANK.bankName}</h2>
          <span className="hidden text-xs text-[#6b6b70] sm:inline">· {tracks.length} tracks{total != null ? ` · ${formatDuration(total)}` : ""}</span>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-white/[0.08] px-2.5 py-1 text-xs text-[#a1a1a6] transition hover:border-white/20 hover:text-[#f5f5f7]">Close</button>
      </header>

      {/* Hero / Play all */}
      <section className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Pilot Bank</p>
          <h1 className="mt-0.5 text-xl font-semibold leading-tight tracking-tight text-white">{SHUFERSAL_DEMO_BANK.bankName}</h1>
          <p className="mt-1 text-[11px] font-medium text-[#8a8a8f]">{tracks.length} tracks{total != null ? ` · ${formatDuration(total)}` : ""}</p>
        </div>
        <button
          type="button"
          disabled={!streamReady}
          onClick={() => playFrom(null)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#101014] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/30 disabled:text-white/60"
        >
          <PlayIcon className="h-3.5 w-3.5" />
          Play all
        </button>
      </section>

      {hint ? <p className="px-5 pt-3 text-[11px] text-[#6b6b70]">{hint}</p> : null}

      {/* Dense track list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="px-2 py-2">
          {tracks.map((track, i) => {
            const active = nowPlaying === track.id;
            return (
              <li key={track.id} className={`group flex items-center gap-3 rounded-md px-2.5 py-1.5 transition ${active ? "bg-[#0a84ff]/12" : "hover:bg-white/[0.03]"}`}>
                <span className={`w-6 shrink-0 text-right text-[11px] tabular-nums ${active ? "text-[#7db8ff]" : "text-[#5a5a5f]"}`}>{i + 1}</span>
                <button
                  type="button"
                  disabled={!streamReady}
                  onClick={() => playFrom(track.id)}
                  className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-gradient-to-br from-[#0a84ff]/70 to-[#4a2b8c]/70 text-white transition disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Play ${track.title}`}
                >
                  <PlayIcon className="h-3.5 w-3.5" />
                </button>
                <span className={`min-w-0 flex-1 truncate text-sm ${active ? "font-medium text-[#f5f5f7]" : "text-[#d1d1d6]"}`}>{track.title}</span>
                {active ? <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#7db8ff]">Playing</span> : null}
                <span className="shrink-0 text-xs tabular-nums text-[#8a8a8f]">{typeof track.durationSeconds === "number" ? formatDuration(track.durationSeconds) : "—"}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
