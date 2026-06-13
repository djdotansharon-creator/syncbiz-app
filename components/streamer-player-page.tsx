"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDevicePlayer } from "@/lib/device-player-context";
import { usePlaybackOptional } from "@/lib/playback-provider";
import { primeIOSFromGesture } from "@/lib/ios-audio-unlock";
import { persistStreamerDeviceFlag } from "@/lib/streamer-device-mode";
import { hasStreamerDeviceToken, clearStreamerDeviceCredentials } from "@/lib/streamer-device-client";

function statusLabel(status: string | undefined): string {
  if (status === "connected") return "Online";
  if (status === "connecting") return "Connecting…";
  if (status === "error") return "Error";
  return "Offline";
}

function playbackStatusLabel(status: string | undefined): string {
  if (status === "playing") return "Playing";
  if (status === "paused") return "Paused";
  if (status === "stopped") return "Stopped";
  return "Idle";
}

/**
 * Headless / TV branch player for GOtv and Android TV streamers.
 * Registers as branch_streamer_station, auto-reclaims MASTER, executes remote WS commands locally.
 */
export function StreamerPlayerPage() {
  const router = useRouter();
  const deviceCtx = useDevicePlayer();
  const playback = usePlaybackOptional();

  useEffect(() => {
    persistStreamerDeviceFlag();
    if (!hasStreamerDeviceToken()) {
      router.replace("/streamer/setup");
    }
  }, [router]);

  const wsStatus = deviceCtx?.status ?? "disconnected";
  const deviceMode = deviceCtx?.deviceMode ?? "CONTROL";
  const branchConnected = deviceCtx?.isBranchConnected ?? false;
  const currentSource = playback?.currentSource;
  const currentTrack = playback?.currentTrack;
  const queueLength = playback?.queue?.length ?? 0;
  const queueIndex = playback?.queueIndex ?? 0;
  const playStatus = playback?.status;

  const unlockBranchAudio = useCallback(() => {
    primeIOSFromGesture();
    playback?.play();
  }, [playback]);

  const title = currentTrack?.title ?? currentSource?.title ?? "No track loaded";
  const playlistName = currentSource?.playlist?.name ?? currentSource?.title ?? null;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-400/90">SyncBiz Branch Player</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">Streamer device</h1>
        <p className="text-sm text-slate-400">
          Headless audio output for this branch. Control from phone or desktop while this device stays MASTER.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Connection status">
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Branch socket</p>
          <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-100">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                wsStatus === "connected"
                  ? "bg-emerald-400 animate-pulse"
                  : wsStatus === "connecting"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-slate-600"
              }`}
              aria-hidden
            />
            {statusLabel(wsStatus)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {branchConnected ? "Registered as PLAYER_DEVICE" : "Waiting for auth / WebSocket…"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Lease role</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{deviceMode}</p>
          <p className="mt-1 text-xs text-slate-500">
            {deviceMode === "MASTER"
              ? "This device outputs branch audio."
              : "Reclaiming MASTER… phones mirror this player when promoted."}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-950/70 px-5 py-5" aria-label="Now playing">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Now playing</p>
        <p className="mt-2 text-xl font-semibold leading-snug text-slate-50 sm:text-2xl">{title}</p>
        {playlistName && playlistName !== title ? (
          <p className="mt-1 text-sm text-slate-400">Playlist: {playlistName}</p>
        ) : null}
        <p className="mt-3 text-sm text-slate-400">{playbackStatusLabel(playStatus)}</p>
        {deviceMode === "MASTER" && playStatus !== "playing" && currentSource ? (
          <button
            type="button"
            className="mt-4 rounded-lg border border-sky-500/50 bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/25"
            onClick={unlockBranchAudio}
          >
            Tap to start branch audio
          </button>
        ) : null}
        <p className="mt-3 text-[11px] text-slate-500">
          Audio plays in the dock below — use your TV remote to focus it if sound is silent.
        </p>
      </section>

      <section className="rounded-xl border border-slate-800/80 bg-slate-900/45 px-4 py-3" aria-label="Queue">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Queue</p>
        <p className="mt-1 text-sm text-slate-300">
          {queueLength > 0
            ? `${queueIndex + 1} of ${queueLength} in queue`
            : currentSource
              ? "Single source (no multi-track queue)"
              : "Empty — send PLAY from a controller"}
        </p>
      </section>

      <footer className="mt-auto space-y-1 text-[11px] text-slate-600">
        <p>Bookmark: <span className="font-mono text-slate-500">/streamer?device=streamer&amp;mode=player</span></p>
        <p>
          <button
            type="button"
            className="text-sky-500/80 hover:text-sky-400"
            onClick={() => {
              clearStreamerDeviceCredentials();
              void fetch("/api/streamer/auth/session", { method: "DELETE" });
              router.push("/streamer/setup");
            }}
          >
            Re-pair device
          </button>
        </p>
        <p>Device id: {deviceCtx?.deviceId ?? "…"}</p>
      </footer>
    </div>
  );
}
