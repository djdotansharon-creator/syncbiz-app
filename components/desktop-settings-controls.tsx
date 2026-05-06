"use client";

import { useCallback, useEffect, useState } from "react";

type AutoStartState = {
  enabled: boolean;
  supported: boolean;
};

type MusicFolderSnapshot = {
  path: string | null;
};

type LoadState = "idle" | "loading" | "ready" | "web-only";

/**
 * Electron is detected by the presence of the preload bridge — same convention
 * as `desktop-mpv-test-panel.tsx`. Outdated desktop builds expose `syncbizDesktop`
 * but may be missing newer methods; per-method capability is checked separately
 * so the controls still render in Electron and surface a clear "update needed" hint.
 */
function isInElectron(): boolean {
  if (typeof window === "undefined") return false;
  return "syncbizDesktop" in window && Boolean(window.syncbizDesktop);
}

function autoStartApiAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const api = window.syncbizDesktop;
  return Boolean(api?.getAutoStart && api?.setAutoStart);
}

function musicFolderApiAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const api = window.syncbizDesktop;
  return Boolean(api?.getMusicFolder && api?.pickMusicFolder && api?.clearMusicFolder);
}

export function DesktopSettingsControls() {
  const [load, setLoad] = useState<LoadState>("idle");
  const [autoStart, setAutoStart] = useState<AutoStartState | null>(null);
  const [musicFolder, setMusicFolder] = useState<MusicFolderSnapshot>({ path: null });
  const [busy, setBusy] = useState<"autostart" | "pick" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isInElectron()) {
      setLoad("web-only");
      return;
    }
    let cancelled = false;
    setLoad("loading");
    (async () => {
      try {
        const api = window.syncbizDesktop;
        const [a, m] = await Promise.all([
          api?.getAutoStart ? api.getAutoStart() : Promise.resolve<AutoStartState | null>(null),
          api?.getMusicFolder ? api.getMusicFolder() : Promise.resolve<MusicFolderSnapshot>({ path: null }),
        ]);
        if (cancelled) return;
        setAutoStart(a ?? null);
        setMusicFolder(m ?? { path: null });
        setLoad("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoad("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggleAutoStart = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.setAutoStart || !autoStart) return;
    setBusy("autostart");
    setError(null);
    try {
      const next = await api.setAutoStart(!autoStart.enabled);
      setAutoStart(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [autoStart]);

  const onPickFolder = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.pickMusicFolder) return;
    setBusy("pick");
    setError(null);
    try {
      const result = await api.pickMusicFolder();
      if (result.status === "ok") {
        setMusicFolder({ path: result.path });
      } else if (result.status === "error") {
        setError(result.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const onClearFolder = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.clearMusicFolder) return;
    setBusy("clear");
    setError(null);
    try {
      const next = await api.clearMusicFolder();
      setMusicFolder(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  if (load === "web-only") {
    return (
      <p className="text-xs text-slate-500">
        Open SyncBiz in the desktop app to configure auto-start and your local music folder.
      </p>
    );
  }

  if (load === "idle" || load === "loading") {
    return <p className="text-xs text-slate-500">Loading desktop settings…</p>;
  }

  const autoStartReady = autoStartApiAvailable();
  const musicFolderReady = musicFolderApiAvailable();
  const outdated = !autoStartReady || !musicFolderReady;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-slate-200">Launch SyncBiz when computer starts</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {!autoStartReady
              ? "Update the SyncBiz desktop app to enable this control."
              : autoStart?.supported
                ? "Adds SyncBiz to your OS login items."
                : "Not supported on this platform."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoStartReady ? Boolean(autoStart?.enabled) : false}
          disabled={!autoStartReady || !autoStart?.supported || busy === "autostart"}
          onClick={onToggleAutoStart}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
            autoStartReady && autoStart?.enabled ? "bg-emerald-500/80" : "bg-slate-700"
          } ${
            !autoStartReady || !autoStart?.supported || busy === "autostart"
              ? "opacity-50"
              : "hover:opacity-90"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              autoStartReady && autoStart?.enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div>
        <p className="text-sm text-slate-200">Music folder</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {musicFolderReady
            ? "Folder used for browsing local music files in the desktop app."
            : "Update the SyncBiz desktop app to enable this control."}
        </p>
        <div className="mt-2 rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
          {musicFolder.path ? (
            <span className="break-all font-mono">{musicFolder.path}</span>
          ) : (
            <span className="text-slate-500">No folder selected</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPickFolder}
            disabled={!musicFolderReady || busy === "pick"}
            className="rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50"
          >
            {musicFolder.path ? "Change" : "Choose folder"}
          </button>
          {musicFolder.path ? (
            <button
              type="button"
              onClick={onClearFolder}
              disabled={!musicFolderReady || busy === "clear"}
              className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100 disabled:opacity-50"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {outdated ? (
        <p className="text-[11px] text-amber-400/90">
          Some controls are unavailable in this desktop build. Update the SyncBiz desktop app to use them.
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-rose-400">{error}</p> : null}
    </div>
  );
}
