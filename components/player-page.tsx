"use client";

import { useMemo, useRef, useState } from "react";
import type { BrowserPreference, Device } from "@/lib/types";

type Props = {
  devices: Device[];
};

type RuntimeStatus = "playing" | "paused" | "stopped";

function isDirectMediaUrl(url: string): boolean {
  return /\.(mp3|aac|ogg|wav|m4a|mp4|webm|m3u8)(\?|#|$)/i.test(url);
}

function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?/]+)/i);
  return m ? m[1] : null;
}

function deriveEmbedUrl(url: string): string | null {
  if (!url) return null;
  const ytId = getYouTubeId(url);
  if (ytId) return `https://www.youtube.com/embed/${ytId}?autoplay=1`;
  if (url.includes("open.spotify.com/")) {
    return url.replace("open.spotify.com/", "open.spotify.com/embed/");
  }
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return null;
}

function deriveArtwork(url: string): string | null {
  const ytId = getYouTubeId(url);
  if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  return null;
}

export function PlayerPage({ devices }: Props) {
  const [inputUrl, setInputUrl] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("local-device");
  const [browserPreference, setBrowserPreference] = useState<BrowserPreference>("default");
  const [openInBrowser, setOpenInBrowser] = useState(true);
  const [status, setStatus] = useState<RuntimeStatus>("stopped");
  const [volume, setVolume] = useState(80);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [activeUrl, setActiveUrl] = useState("");
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playlist = useMemo(
    () => inputUrl.split("\n").map((x) => x.trim()).filter(Boolean),
    [inputUrl],
  );
  const currentUrl = playlist[playlistIndex] ?? inputUrl.trim();
  const artworkUrl = deriveArtwork(currentUrl);
  const embedUrl = deriveEmbedUrl(currentUrl);
  const canSeek = isDirectMediaUrl(activeUrl);

  async function sendCommand(action: string, target?: string) {
    const payload = {
      action,
      target: target ?? currentUrl,
      deviceId: selectedDeviceId,
      browserPreference,
      currentTime: position,
      volume,
      openInBrowser,
    };
    const res = await fetch("/api/player/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "Command failed");
    }
  }

  async function handlePlay() {
    if (!currentUrl) return;
    setFeedback(null);
    try {
      setActiveUrl(currentUrl);
      setStatus("playing");
      if (!openInBrowser && isDirectMediaUrl(currentUrl) && audioRef.current) {
        audioRef.current.src = currentUrl;
        audioRef.current.volume = volume / 100;
        await audioRef.current.play();
      }
      await sendCommand("play", currentUrl);
      setFeedback("Local playback command sent");
    } catch (e) {
      setStatus("stopped");
      setFeedback(`Failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }

  async function handlePause() {
    setStatus("paused");
    if (audioRef.current) audioRef.current.pause();
    try {
      await sendCommand("pause");
      setFeedback("Pause command sent");
    } catch (e) {
      setFeedback(`Failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }

  async function handleStop() {
    setStatus("stopped");
    setPosition(0);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    setActiveUrl("");
    try {
      await sendCommand("stop");
      setFeedback("Stop command sent");
    } catch (e) {
      setFeedback(`Failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }

  async function handleSeek(next: number) {
    setPosition(next);
    if (audioRef.current && canSeek) audioRef.current.currentTime = next;
    await sendCommand("seek");
  }

  async function handleVolume(next: number) {
    setVolume(next);
    if (audioRef.current) audioRef.current.volume = next / 100;
    await sendCommand("volume");
  }

  async function stepPlaylist(dir: 1 | -1) {
    if (playlist.length < 2) return;
    const next = (playlistIndex + dir + playlist.length) % playlist.length;
    setPlaylistIndex(next);
    setActiveUrl(playlist[next]);
    await sendCommand(dir > 0 ? "next" : "prev", playlist[next]);
    setFeedback(dir > 0 ? "Next command sent" : "Previous command sent");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-5">
        <h1 className="text-2xl font-semibold">Player</h1>
        <p className="mt-1 text-sm text-slate-400">
          Paste a media URL, choose target device, and control playback from this page.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,1.2fr]">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-5">
          <div className="aspect-square overflow-hidden rounded-xl bg-slate-900">
            {artworkUrl ? (
              <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-500">
                No artwork
              </div>
            )}
          </div>
          <p className="mt-3 truncate text-sm text-slate-300">{currentUrl || "No target yet"}</p>
          <p className="text-xs text-slate-500">Status: {status}</p>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-5">
          <div>
            <label className="block text-xs font-medium text-slate-400">Media URL</label>
            <textarea
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=... (one URL per line for simple playlist)"
              className="mt-1 h-24 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-400">Target Device</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm"
              >
                <option value="local-device">Local machine</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400">Browser</label>
              <select
                value={browserPreference}
                onChange={(e) => setBrowserPreference(e.target.value as BrowserPreference)}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm"
              >
                <option value="default">Default browser</option>
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="firefox">Firefox</option>
              </select>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={openInBrowser}
              onChange={(e) => setOpenInBrowser(e.target.checked)}
            />
            Open in browser
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={handlePlay} className="h-12 w-12 rounded-full bg-emerald-500 text-slate-950">▶</button>
            <button onClick={handlePause} className="h-12 w-12 rounded-full border border-slate-700 bg-slate-900">⏸</button>
            <button onClick={handleStop} className="h-12 w-12 rounded-full border border-slate-700 bg-slate-900">■</button>
            <button onClick={() => stepPlaylist(-1)} disabled={playlist.length < 2} className="h-10 rounded-xl border border-slate-700 px-3 disabled:opacity-40">Prev</button>
            <button onClick={() => stepPlaylist(1)} disabled={playlist.length < 2} className="h-10 rounded-xl border border-slate-700 px-3 disabled:opacity-40">Next</button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Volume: {volume}</label>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => void handleVolume(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Position: {Math.floor(position)}s
            </label>
            <input
              type="range"
              min={0}
              max={duration || 300}
              value={position}
              onChange={(e) => void handleSeek(Number(e.target.value))}
              disabled={!canSeek}
              className="w-full disabled:opacity-40"
            />
          </div>

          {feedback && <p className="text-sm text-slate-300">{feedback}</p>}
        </div>
      </div>

      {!openInBrowser && (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4">
          {activeUrl && isDirectMediaUrl(activeUrl) ? (
            <audio
              ref={audioRef}
              controls
              className="w-full"
              onTimeUpdate={() => setPosition(audioRef.current?.currentTime ?? 0)}
              onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
              onPause={() => setStatus("paused")}
              onPlay={() => setStatus("playing")}
              onEnded={() => setStatus("stopped")}
            />
          ) : embedUrl ? (
            <iframe
              src={status === "stopped" ? "about:blank" : embedUrl}
              title="Embedded player"
              className="h-[360px] w-full rounded-xl border-0 bg-slate-900"
              allow="autoplay; encrypted-media; picture-in-picture"
            />
          ) : (
            <p className="text-sm text-slate-500">No embeddable target selected yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
