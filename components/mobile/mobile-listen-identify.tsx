"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { useMobileRole } from "@/lib/mobile-role-context";
import { useDevicePlayer } from "@/lib/device-player-context";
import { usePlayback } from "@/lib/playback-provider";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useStationController } from "@/lib/station-controller-context";
import {
  createPlaylistFromUrl,
  resolveYouTubePlayableUrlForSearch,
} from "@/lib/search-playlist-client";
import { savePlaylistToLocal } from "@/lib/unified-sources-client";
import { searchExternal, type YouTubeSearchResult } from "@/lib/search-service";
import type { UnifiedSource } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";

const LISTEN_MS = 7000;

// One-tap flow: Listen → listening → finding → ADDS TO QUEUE automatically →
// a small confirmation with optional extras. The default action (add to queue)
// happens with zero extra taps.
type Phase = "listening" | "resolving" | "adding" | "done" | "error";

/** Pick a MediaRecorder mime the browser supports (Chrome→webm, Safari→mp4). */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

/**
 * In-app song recognition, streamlined to a single tap from the mobile player.
 *
 * Tap "Identify a song" → records ~7s from the mic → /api/sources/recognize-audio
 * (AudD, server-side token) → feeds the recognized artist+title into the EXISTING
 * YouTube resolver → **automatically adds it to the queue** (the chosen default,
 * so nothing playing is interrupted and no extra tap is needed). A compact
 * confirmation then offers Play-now / Add-to-library / Identify-another as
 * optional extras.
 *
 * Entirely inside SyncBiz — no leaving the app. Works in the PWA on Android AND
 * iOS. Hidden until AUDD_API_TOKEN is configured.
 */
export function MobileListenIdentify() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("listening");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<YouTubeSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [extraMsg, setExtraMsg] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistedRef = useRef<{ key: string; source: UnifiedSource } | null>(null);

  const { mobileRole } = useMobileRole();
  const deviceCtx = useDevicePlayer();
  const playback = usePlayback();
  const mobileSources = useMobileSources();
  const station = useStationController();
  const isController = mobileRole === "controller";

  useEffect(() => {
    let alive = true;
    fetch("/api/config/mic-recognition")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => alive && setEnabled(!!d?.enabled))
      .catch(() => alive && setEnabled(false));
    return () => {
      alive = false;
    };
  }, []);

  const cleanupCapture = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    } catch {
      /* ignore */
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
  }, []);

  /** Persist the YouTube result once; reuse across the auto-add and any extras. */
  const getOrCreateSource = useCallback(async (r: YouTubeSearchResult): Promise<UnifiedSource | null> => {
    if (persistedRef.current?.key === r.url) return persistedRef.current.source;
    const playable = r.type === "youtube" ? await resolveYouTubePlayableUrlForSearch(r.url) : r.url;
    const created = await createPlaylistFromUrl(playable, {
      title: r.title,
      genre: "Mixed",
      cover: r.cover,
      type: r.type,
      viewCount: r.viewCount,
      durationSeconds: r.durationSeconds,
    });
    if (!created) return null;
    savePlaylistToLocal(created);
    const source: UnifiedSource = {
      id: `pl-${created.id}`,
      title: created.name,
      genre: created.genre || "Mixed",
      cover: created.thumbnail || null,
      type: created.type as UnifiedSource["type"],
      url: created.url,
      origin: "playlist",
      playlist: created as Playlist,
    };
    persistedRef.current = { key: r.url, source };
    return source;
  }, []);

  /** Add-to-queue ladder — CONTROLLER forwards to MASTER, player queues locally. */
  const queueSource = useCallback(
    (u: UnifiedSource) => {
      if (deviceCtx?.queueNextOrSend) deviceCtx.queueNextOrSend(u);
      else if (isController && station.isCrossDevice) station.sendQueueNext(u);
      else playback.addPlayNextSources([u]);
    },
    [deviceCtx, isController, station, playback],
  );

  /** Resolve the recognized song to YouTube and AUTO-ADD it to the queue. */
  const runResolveAndQueue = useCallback(
    async (artist: string, title: string) => {
      setPhase("resolving");
      const heard = [artist, title].filter(Boolean).join(" – ");
      const query = `${artist} ${title}`.trim();
      let first: YouTubeSearchResult | null = null;
      try {
        const { youtube } = await searchExternal(query);
        first = youtube.find((r) => r.type === "youtube") ?? youtube[0] ?? null;
      } catch {
        setError("Search failed. Please try again.");
        setPhase("error");
        return;
      }
      if (!first) {
        setError(`Heard "${heard}" but found no YouTube match.`);
        setPhase("error");
        return;
      }
      setResult(first);
      setPhase("adding");
      try {
        const u = await getOrCreateSource(first);
        if (!u) {
          setError("Couldn't save the track. Please try again.");
          setPhase("error");
          return;
        }
        queueSource(u); // ← the default action, automatic (no extra tap)
        setPhase("done");
      } catch {
        setError("Couldn't add the track. Please try again.");
        setPhase("error");
      }
    },
    [getOrCreateSource, queueSource],
  );

  const recognizeBlob = useCallback(
    async (blob: Blob) => {
      setPhase("resolving");
      try {
        const fd = new FormData();
        fd.append("audio", blob, "clip");
        const res = await fetch("/api/sources/recognize-audio", { method: "POST", body: fd });
        const data = (await res.json().catch(() => null)) as
          | { ok: boolean; artist?: string; title?: string; reason?: string }
          | null;
        if (!data || !data.ok) {
          const reason = data?.reason;
          setError(
            reason === "not_found"
              ? "Couldn't recognize the song — try again closer to the speaker."
              : reason === "not_configured"
                ? "Song recognition isn't set up yet."
                : "Recognition failed. Please try again.",
          );
          setPhase("error");
          return;
        }
        await runResolveAndQueue(data.artist ?? "", data.title ?? "");
      } catch {
        setError("Recognition failed. Please try again.");
        setPhase("error");
      }
    },
    [runResolveAndQueue],
  );

  const startListening = useCallback(async () => {
    setOpen(true);
    setError(null);
    setResult(null);
    setExtraMsg(null);
    persistedRef.current = null;
    setPhase("listening");

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Your browser can't record audio here.");
      setPhase("error");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone permission is needed to identify a song.");
      setPhase("error");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      setError("Your browser can't record audio here.");
      setPhase("error");
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (blob.size > 0) void recognizeBlob(blob);
      else {
        setError("Didn't capture any audio. Please try again.");
        setPhase("error");
      }
    };
    recorder.start();
    stopTimerRef.current = setTimeout(() => {
      try {
        if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
    }, LISTEN_MS);
  }, [recognizeBlob]);

  const close = useCallback(() => {
    cleanupCapture();
    setOpen(false);
  }, [cleanupCapture]);

  useEffect(() => () => cleanupCapture(), [cleanupCapture]);

  /** Optional extras from the confirmation card (source already persisted). */
  const withExtra = useCallback(
    async (fn: (u: UnifiedSource) => void, msg: string) => {
      if (!result) return;
      setBusy(true);
      setError(null);
      try {
        const u = await getOrCreateSource(result);
        if (!u) {
          setError("Something went wrong. Please try again.");
          return;
        }
        fn(u);
        setExtraMsg(msg);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [result, getOrCreateSource],
  );

  const playNow = useCallback(
    () =>
      withExtra((u) => {
        if (deviceCtx?.playSourceOrSend) deviceCtx.playSourceOrSend(u);
        else if (isController && station.isCrossDevice) station.sendPlaySource(u);
        else playback.playSource(u);
      }, "Playing now"),
    [withExtra, deviceCtx, isController, station, playback],
  );
  const addToLibrary = useCallback(
    () => withExtra((u) => mobileSources.addSource(u), "Added to your library"),
    [withExtra, mobileSources],
  );

  if (enabled !== true) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void startListening()}
        aria-label="Identify a song and add it to the queue"
        className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-[color:var(--sb-accent-border)] bg-[color:var(--sb-accent-soft)] px-4 py-3 text-[15px] font-semibold text-[#409cff] transition active:scale-[0.99]"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
        Identify a song
      </button>

      {open && (
        <div className="fixed inset-0 z-[65]" role="dialog" aria-modal="true" aria-label="Identify a song">
          <button type="button" aria-label="Close" onClick={close} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-slate-700/60 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 p-5 pb-8 shadow-[0_-20px_60px_rgba(0,0,0,0.6)]">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-700" aria-hidden />

            {phase === "listening" ? (
              <div className="flex flex-col items-center py-6">
                <span className="relative flex h-20 w-20 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--sb-accent-soft)]" />
                  <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--sb-accent-soft)] text-[#409cff]">
                    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                    </svg>
                  </span>
                </span>
                <p className="mt-5 text-[15px] font-semibold text-slate-100">Listening…</p>
                <p className="mt-1 text-[13px] text-slate-400">Hold near the speaker.</p>
              </div>
            ) : phase === "resolving" ? (
              <div className="py-10 text-center text-[15px] font-semibold text-slate-200">Finding the song…</div>
            ) : phase === "adding" ? (
              <div className="py-10 text-center text-[15px] font-semibold text-slate-200">Adding to the queue…</div>
            ) : phase === "error" ? (
              <div className="py-6 text-center">
                <p className="mb-4 text-[14px] text-amber-100">{error}</p>
                <button type="button" onClick={() => void startListening()} className="rounded-xl bg-[var(--sb-text)] px-4 py-2.5 text-[14px] font-semibold text-[#111114] active:scale-95">
                  Try again
                </button>
              </div>
            ) : phase === "done" && result ? (
              <div>
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                    {result.cover ? <HydrationSafeImage src={result.cover} alt="" className="h-full w-full object-cover" /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-slate-50">{result.title}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[12px] font-medium text-emerald-300">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      Added to the queue
                    </p>
                  </div>
                </div>
                {extraMsg ? (
                  <p className="mt-3 rounded-lg border border-[color:var(--sb-accent-border)] bg-[color:var(--sb-accent-soft)] px-3 py-2 text-center text-[13px] text-[#409cff]">
                    {extraMsg}
                  </p>
                ) : null}
                {error ? <p className="mt-3 text-center text-[13px] text-amber-100">{error}</p> : null}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={playNow} disabled={busy} className={SECONDARY_BTN}>Play now</button>
                  <button type="button" onClick={addToLibrary} disabled={busy} className={SECONDARY_BTN}>Add to library</button>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <button type="button" onClick={() => void startListening()} disabled={busy} className="text-[13px] text-slate-400 active:scale-[0.99]">
                    Identify another
                  </button>
                  <button type="button" onClick={close} className="text-[13px] font-semibold text-slate-200 active:scale-[0.99]">
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

const SECONDARY_BTN =
  "flex items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 py-2.5 text-[14px] font-semibold text-slate-100 transition hover:bg-white/[0.08] active:scale-95 disabled:opacity-40 disabled:pointer-events-none";
