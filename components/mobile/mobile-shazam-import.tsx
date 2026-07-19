"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { tryBuildExternalMusicYoutubeSearchQuery } from "@/lib/external-music-youtube-resolve";
import type { ParseUrlJson, UnifiedSource } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";

const PENDING_KEY = "syncbiz:shazamImportPending";
// Shazam associated-domain universal link. On a device with the app installed
// this MAY open the app (to its home, not a deep recognition screen — there is
// no public deep link for that); otherwise it opens the Shazam site. We never
// claim more than this, and never use an undocumented custom scheme.
const SHAZAM_UNIVERSAL_URL = "https://www.shazam.com/";
const SHAZAM_PLAY_STORE = "https://play.google.com/store/apps/details?id=com.shazam.android";
const SHAZAM_APP_STORE = "https://apps.apple.com/app/shazam-music-discovery/id284993459";

type Mode = "menu" | "paste" | "manual";
type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

export function MobileShazamImport() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [returnedPrompt, setReturnedPrompt] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [artist, setArtist] = useState("");
  const [song, setSong] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<YouTubeSearchResult | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const platform = useMemo(detectPlatform, []);
  const { mobileRole } = useMobileRole();
  const deviceCtx = useDevicePlayer();
  const playback = usePlayback();
  const mobileSources = useMobileSources();
  const station = useStationController();
  const isController = mobileRole === "controller";

  // Persist the resolved source only once, then reuse it across actions so we
  // don't create duplicate playlist rows for the same song.
  const persistedRef = useRef<{ key: string; source: UnifiedSource } | null>(null);

  // Feature flag (server-only env, surfaced via /api/config). Hidden until confirmed.
  useEffect(() => {
    let alive = true;
    fetch("/api/config/shazam-import")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => alive && setEnabled(!!d?.enabled))
      .catch(() => alive && setEnabled(false));
    return () => {
      alive = false;
    };
  }, []);

  const resetFlow = useCallback(() => {
    setMode("menu");
    setLinkInput("");
    setArtist("");
    setSong("");
    setError(null);
    setResult(null);
    setActionMsg(null);
    persistedRef.current = null;
  }, []);

  const openSheet = useCallback((returned: boolean) => {
    setReturnedPrompt(returned);
    setMode("menu");
    setError(null);
    setResult(null);
    setActionMsg(null);
    persistedRef.current = null;
    setOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setOpen(false);
    setReturnedPrompt(false);
  }, []);

  // When SyncBiz returns to the foreground after an "Open Shazam", reopen the
  // sheet in the "Did Shazam find the song?" state. Fires on both tab-return
  // (visibilitychange) and bfcache restore (pageshow).
  useEffect(() => {
    if (enabled !== true) return;
    const check = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        if (localStorage.getItem(PENDING_KEY) === "1") {
          localStorage.removeItem(PENDING_KEY);
          openSheet(true);
        }
      } catch {
        /* storage blocked — no-op */
      }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", check);
    check();
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", check);
    };
  }, [enabled, openSheet]);

  const handleOpenShazam = useCallback(() => {
    try {
      localStorage.setItem(PENDING_KEY, "1");
    } catch {
      /* ignore */
    }
    // Keep SyncBiz alive in its own tab; the universal link may hand off to the
    // Shazam app or open the site. Must run inside this click gesture.
    window.open(SHAZAM_UNIVERSAL_URL, "_blank", "noopener,noreferrer");
  }, []);

  const handlePasteFromClipboard = useCallback(async () => {
    // Explicit user action only — never read the clipboard automatically.
    try {
      const text = await navigator.clipboard.readText();
      if (text) setLinkInput(text.trim());
    } catch {
      setError("Couldn't read the clipboard — paste the link into the box instead.");
    }
  }, []);

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 2) {
      setError("Please enter a bit more detail.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    persistedRef.current = null;
    try {
      const { youtube } = await searchExternal(q);
      const first = youtube.find((r) => r.type === "youtube") ?? youtube[0] ?? null;
      if (!first) {
        setError("We couldn't find this track on YouTube. Try the manual entry.");
        return;
      }
      setResult(first);
    } catch {
      setError("Search failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleResolveLink = useCallback(async () => {
    const link = linkInput.trim();
    if (!link) {
      setError("Paste a Shazam link first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/sources/parse-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      if (!res.ok) {
        setError("Couldn't read that link. Make sure it's a Shazam share link.");
        return;
      }
      const parsed = (await res.json()) as ParseUrlJson;
      const built = tryBuildExternalMusicYoutubeSearchQuery(parsed, link);
      const query = built.ok ? built.query : `${parsed.artist ?? ""} ${parsed.song ?? parsed.title ?? ""}`.trim();
      if (!query || query.length < 2) {
        setError("We couldn't read the song from that link. Try the manual entry.");
        return;
      }
      await runSearch(query);
    } catch {
      setError("Couldn't read that link. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [linkInput, runSearch]);

  const handleResolveManual = useCallback(async () => {
    const q = `${artist.trim()} ${song.trim()}`.trim();
    await runSearch(q);
  }, [artist, song, runSearch]);

  /** Persist the YouTube result to a real UnifiedSource once; reuse thereafter. */
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

  const withAction = useCallback(
    async (fn: (u: UnifiedSource) => void, successMsg: string) => {
      if (!result) return;
      setBusy(true);
      setError(null);
      try {
        const u = await getOrCreateSource(result);
        if (!u) {
          setError("Couldn't save the track. Please try again.");
          return;
        }
        fn(u);
        setActionMsg(successMsg);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [result, getOrCreateSource]
  );

  // Play now — playSourceOrSend routes correctly in both modes (CONTROL sends to
  // the MASTER; no local audio on the controller). Never autoplays before this tap.
  const handlePlayNow = useCallback(
    () =>
      withAction((u) => {
        if (deviceCtx?.playSourceOrSend) deviceCtx.playSourceOrSend(u);
        else if (isController && station.isCrossDevice) station.sendPlaySource(u);
        else playback.playSource(u);
      }, "Playing now"),
    [withAction, deviceCtx, isController, station, playback]
  );

  const handleAddToQueue = useCallback(
    () => withAction((u) => playback.addPlayNextSources([u]), "Added to the queue"),
    [withAction, playback]
  );

  const handleAddToLibrary = useCallback(
    () => withAction((u) => mobileSources.addSource(u), "Added to your library"),
    [withAction, mobileSources]
  );

  if (enabled !== true) return null;

  const storeUrl = platform === "ios" ? SHAZAM_APP_STORE : SHAZAM_PLAY_STORE;

  return (
    <>
      <button
        type="button"
        onClick={() => openSheet(false)}
        aria-label="Import from Shazam"
        className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sb-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--sb-text)] active:scale-95"
      >
        {/* Shazam-style concentric mark (generic, not the trademark logo). */}
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8.5a3.5 3.5 0 0 1 3 5.5M12 15.5a3.5 3.5 0 0 1-3-5.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Import from Shazam">
          <button
            type="button"
            aria-label="Close"
            onClick={closeSheet}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-3xl border-t border-slate-700/60 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 p-5 pb-8 shadow-[0_-20px_60px_rgba(0,0,0,0.6)]">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-700" aria-hidden />

            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-slate-50">
                {returnedPrompt ? "Did Shazam find the song?" : "Import from Shazam"}
              </h2>
              <button
                type="button"
                onClick={closeSheet}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800/70 text-slate-300 active:scale-95"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {error && (
              <p className="mb-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-100">
                {error}
              </p>
            )}

            {/* RESULT view */}
            {result ? (
              <div>
                <div className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/60 p-3">
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                    {result.cover ? (
                      <HydrationSafeImage src={result.cover} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-slate-50">{result.title}</p>
                    <p className="text-[12px] text-slate-400">YouTube · found for you</p>
                  </div>
                </div>

                {actionMsg ? (
                  <p className="mt-3 rounded-lg border border-[color:var(--sb-accent-border)] bg-[color:var(--sb-accent-soft)] px-3 py-2 text-center text-[13px] text-[#409cff]">
                    {actionMsg}
                  </p>
                ) : null}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={handlePlayNow} disabled={busy} className={PRIMARY_BTN}>
                    Play now
                  </button>
                  <button type="button" onClick={handleAddToLibrary} disabled={busy} className={SECONDARY_BTN}>
                    Add to library
                  </button>
                  {!isController && (
                    <button type="button" onClick={handleAddToQueue} disabled={busy} className={`${SECONDARY_BTN} col-span-2`}>
                      Add to queue
                    </button>
                  )}
                </div>
                <button type="button" onClick={resetFlow} disabled={busy} className="mt-3 w-full text-center text-[13px] text-slate-400 active:scale-[0.99]">
                  Search a different song
                </button>
              </div>
            ) : mode === "paste" ? (
              <div>
                <p className="mb-2 text-[13px] text-slate-400">Paste the Shazam share link.</p>
                <input
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  placeholder="https://www.shazam.com/…"
                  inputMode="url"
                  autoComplete="off"
                  className="w-full rounded-xl border border-white/[0.12] bg-white/[0.04] px-3.5 py-2.5 text-[15px] text-slate-50 placeholder:text-slate-500 outline-none focus:border-[#0a84ff]/60"
                />
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={handlePasteFromClipboard} disabled={busy} className={SECONDARY_BTN}>
                    Paste
                  </button>
                  <button type="button" onClick={handleResolveLink} disabled={busy || !linkInput.trim()} className={`${PRIMARY_BTN} flex-1`}>
                    {busy ? "Finding…" : "Find on YouTube"}
                  </button>
                </div>
                <button type="button" onClick={() => setMode("menu")} className={BACK_LINK}>← Back</button>
              </div>
            ) : mode === "manual" ? (
              <div>
                <p className="mb-2 text-[13px] text-slate-400">Enter the artist and song.</p>
                <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" className="mb-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.04] px-3.5 py-2.5 text-[15px] text-slate-50 placeholder:text-slate-500 outline-none focus:border-[#0a84ff]/60" />
                <input value={song} onChange={(e) => setSong(e.target.value)} placeholder="Song title" className="w-full rounded-xl border border-white/[0.12] bg-white/[0.04] px-3.5 py-2.5 text-[15px] text-slate-50 placeholder:text-slate-500 outline-none focus:border-[#0a84ff]/60" />
                <button type="button" onClick={handleResolveManual} disabled={busy || (!artist.trim() && !song.trim())} className={`${PRIMARY_BTN} mt-3 w-full`}>
                  {busy ? "Finding…" : "Find on YouTube"}
                </button>
                <button type="button" onClick={() => setMode("menu")} className={BACK_LINK}>← Back</button>
              </div>
            ) : (
              /* MENU */
              <div className="space-y-2.5">
                {!returnedPrompt && (
                  <button type="button" onClick={handleOpenShazam} className={PRIMARY_BTN + " w-full"}>
                    Open Shazam
                  </button>
                )}
                {returnedPrompt && (
                  <button type="button" onClick={handleOpenShazam} className={SECONDARY_BTN + " w-full"}>
                    Open Shazam again
                  </button>
                )}
                <button type="button" onClick={() => { setMode("paste"); setError(null); }} className={SECONDARY_BTN + " w-full"}>
                  Paste Shazam link
                </button>
                <button type="button" onClick={() => { setMode("manual"); setError(null); }} className={SECONDARY_BTN + " w-full"}>
                  Enter artist and song
                </button>
                {returnedPrompt && (
                  <button type="button" onClick={closeSheet} className="w-full py-1 text-center text-[13px] text-slate-400">
                    Cancel
                  </button>
                )}
                <p className="pt-1 text-center text-[12px] text-slate-500">
                  Don&apos;t have Shazam?{" "}
                  <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="text-[#409cff] underline">
                    Get it {platform === "ios" ? "on the App Store" : platform === "android" ? "on Google Play" : ""}
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const PRIMARY_BTN =
  "flex items-center justify-center rounded-xl bg-[var(--sb-text)] px-4 py-2.5 text-[14px] font-semibold text-[#111114] transition active:scale-95 disabled:opacity-40 disabled:pointer-events-none";
const SECONDARY_BTN =
  "flex items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 py-2.5 text-[14px] font-semibold text-slate-100 transition hover:bg-white/[0.08] active:scale-95 disabled:opacity-40 disabled:pointer-events-none";
const BACK_LINK = "mt-3 block w-full text-center text-[13px] text-slate-400 active:scale-[0.99]";
