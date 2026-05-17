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

/** Login item toggle — first card under Settings. */
export function DesktopStartupSettingsCard() {
  const [load, setLoad] = useState<LoadState>("idle");
  const [autoStart, setAutoStart] = useState<AutoStartState | null>(null);
  const [busy, setBusy] = useState(false);
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
        const a = api?.getAutoStart ? await api.getAutoStart() : null;
        if (cancelled) return;
        setAutoStart(a ?? null);
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
    setBusy(true);
    setError(null);
    try {
      const next = await api.setAutoStart(!autoStart.enabled);
      setAutoStart(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [autoStart]);

  if (load === "web-only") {
    return (
      <p className="text-xs text-slate-500">
        Open SyncBiz in the desktop app to configure startup options.
      </p>
    );
  }

  if (load === "idle" || load === "loading") {
    return <p className="text-xs text-slate-500">Loading…</p>;
  }

  const autoStartReady = autoStartApiAvailable();

  return (
    <div className="space-y-3">
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
          disabled={!autoStartReady || !autoStart?.supported || busy}
          onClick={onToggleAutoStart}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
            autoStartReady && autoStart?.enabled ? "bg-emerald-500/80" : "bg-slate-700"
          } ${!autoStartReady || !autoStart?.supported || busy ? "opacity-50" : "hover:opacity-90"}`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              autoStartReady && autoStart?.enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      {!autoStartReady ? (
        <p className="text-[11px] text-amber-400/90">
          Some controls are unavailable in this desktop build. Update the SyncBiz desktop app to use them.
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-rose-400">{error}</p> : null}
    </div>
  );
}

/** Music folder — persists immediately after pick; no Save button. */
export function DesktopLocalMusicSettingsCard() {
  const [load, setLoad] = useState<LoadState>("idle");
  const [musicFolder, setMusicFolder] = useState<MusicFolderSnapshot>({ path: null });
  const [busy, setBusy] = useState<"pick" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderStatus, setFolderStatus] = useState<string | null>(null);

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
        const m = api?.getMusicFolder ? await api.getMusicFolder() : { path: null };
        if (cancelled) return;
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

  const onPickFolder = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.pickMusicFolder) return;
    setBusy("pick");
    setError(null);
    setFolderStatus(null);
    try {
      const result = await api.pickMusicFolder();
      if (result.status === "ok") {
        setMusicFolder({ path: result.path });
        setFolderStatus("Saved automatically");
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
    setFolderStatus(null);
    try {
      const next = await api.clearMusicFolder();
      setMusicFolder(next);
      setFolderStatus("Folder cleared");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  if (load === "web-only") {
    return (
      <p className="text-xs text-slate-500">
        Open SyncBiz in the desktop app to choose a local music folder.
      </p>
    );
  }

  if (load === "idle" || load === "loading") {
    return <p className="text-xs text-slate-500">Loading…</p>;
  }

  const musicFolderReady = musicFolderApiAvailable();

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-slate-200">Music Folder</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {musicFolderReady
            ? "Used for the My Music Library workspace. Saved as soon as you choose a folder."
            : "Update the SyncBiz desktop app to enable this control."}
        </p>
        <input
          readOnly
          tabIndex={-1}
          aria-readonly
          value={musicFolder.path ?? ""}
          placeholder="No folder selected"
          className="mt-2 w-full cursor-default rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-2 font-mono text-xs text-slate-400 shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] outline-none focus:ring-0"
        />
      </div>
      <div className="flex flex-wrap gap-2">
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
      {folderStatus ? <p className="text-[11px] text-emerald-400/90">{folderStatus}</p> : null}
      {!musicFolderReady ? (
        <p className="text-[11px] text-amber-400/90">
          Some controls are unavailable in this desktop build. Update the SyncBiz desktop app to use them.
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-rose-400">{error}</p> : null}
    </div>
  );
}
