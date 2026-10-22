"use client";

import { useCallback, useEffect, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";

type ProtectionState = {
  enabled: boolean;
  supported: boolean;
  taskPresent: boolean | null;
  source: string;
  drift: "none" | "task_missing" | "task_unexpected" | "task_unknown";
  healthy: boolean;
  error?: string;
};

type MusicFolderSnapshot = {
  /** Absolute path — internal only. NEVER rendered (customer privacy). */
  path: string | null;
  /** Safe label for the UI: folder name only, no drive letter / no location. */
  displayLabel?: string | null;
  /** True when the folder is a managed PlayItPro bank (label hides everything). */
  isPlaylistProLibrary?: boolean;
};

type LoadState = "idle" | "loading" | "ready" | "web-only";

function isInElectron(): boolean {
  if (typeof window === "undefined") return false;
  return "syncbizDesktop" in window && Boolean(window.syncbizDesktop);
}

function protectionApiAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const api = window.syncbizDesktop;
  return Boolean(api?.getProtectionState && api?.setProtectionState);
}

function musicFolderApiAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const api = window.syncbizDesktop;
  return Boolean(api?.getMusicFolder && api?.pickMusicFolder && api?.clearMusicFolder);
}

/**
 * VONO Protection — the real unattended-branch-player control (Scheduled Task + watchdog), NOT the legacy
 * Electron openAtLogin toggle. Uses ONLY getProtectionState/setProtectionState (+ optional exitVono).
 */
export function DesktopStartupSettingsCard() {
  const tr = useTr();
  const [load, setLoad] = useState<LoadState>("idle");
  const [protection, setProtection] = useState<ProtectionState | null>(null);
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
        const p = api?.getProtectionState ? await api.getProtectionState() : null;
        if (cancelled) return;
        setProtection(p ?? null);
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

  const onToggleProtection = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.setProtectionState || !protection) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.setProtectionState(!protection.enabled);
      setProtection(next);
      // The service reports the UNCHANGED prior state + an error string when a transition fails.
      if (next.error) setError(next.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [protection]);

  // Drift repair RE-APPLIES the current desired state (never inverts it): task_missing + desired ON → send true
  // (re-install), task_unexpected + desired OFF → send false (remove), task_unknown → re-apply current desired
  // (setEnabled stays fail-closed if the status is still unknown). This is why drift uses an explicit Repair
  // action instead of the ON/OFF toggle, which would flip the operator's intent.
  const onRepair = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.setProtectionState || !protection) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.setProtectionState(protection.enabled);
      setProtection(next);
      if (next.error) setError(next.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [protection]);

  const onExitVono = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.exitVono) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.exitVono();
      // ok:true → the app is quitting; ok:false → the Exit marker could not be written, so VONO stayed open.
      if (!res.ok) {
        setError(res.error || "Could not exit safely; VONO is still running to avoid an auto-restart.");
        setBusy(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, []);

  if (load === "web-only") {
    return (
      <p className="text-xs text-slate-500">
        {tr("VONO Protection is configured from the VONO Desktop app on the branch player.")}
      </p>
    );
  }

  if (load === "idle" || load === "loading") {
    return <p className="text-xs text-slate-500">{tr("Loading…")}</p>;
  }

  const ready = protectionApiAvailable();
  const on = ready && Boolean(protection?.enabled);
  const supported = Boolean(protection?.supported);
  const healthy = ready && Boolean(protection?.healthy);
  // Drift (desired state ≠ live task) is surfaced from the effective state, plus any transition error.
  const drifted = ready && supported && Boolean(protection) && protection!.drift !== "none";
  const driftError = drifted ? protection?.error : undefined;
  const shownError = error ?? driftError ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-slate-200">{tr("VONO Protection")}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {!ready
              ? tr("Update the SyncBiz desktop app to manage Protection.")
              : !supported
                ? tr("Not supported on this platform.")
                : on
                  ? tr("VONO starts with Windows and automatically recovers the player if it stops.")
                  : tr("Manual mode. VONO will not auto-start or recover after it is closed.")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={tr("VONO Protection")}
          disabled={!ready || !supported || busy || drifted}
          onClick={onToggleProtection}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
            on ? "bg-emerald-500/80" : "bg-slate-700"
          } ${!ready || !supported || busy || drifted ? "opacity-50" : "hover:opacity-90"}`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              on ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {ready && supported ? (
        <p className={`text-[11px] ${healthy && on ? "text-emerald-400/90" : "text-slate-500"}`}>
          {healthy
            ? on
              ? tr("Protected · automatic startup and recovery enabled")
              : tr("Off · manual mode")
            : protection?.drift === "task_unknown"
              ? tr("Protection status could not be determined — use Repair to re-check.")
              : protection?.drift === "task_missing"
                ? tr("Enabled, but the watchdog task is missing — use Repair to re-install it.")
                : protection?.drift === "task_unexpected"
                  ? tr("Off, but a watchdog task is still active — use Repair to remove it.")
                  : on
                    ? tr("Protected · automatic startup and recovery enabled")
                    : tr("Off · manual mode")}
        </p>
      ) : null}

      {drifted ? (
        <button
          type="button"
          onClick={onRepair}
          disabled={busy}
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {tr("Repair Protection")}
        </button>
      ) : null}

      {ready && window.syncbizDesktop?.exitVono ? (
        <button
          type="button"
          onClick={onExitVono}
          disabled={busy}
          className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {tr("Exit VONO")}
        </button>
      ) : null}

      {!ready ? (
        <p className="text-[11px] text-amber-400/90">
          {tr("Some controls are unavailable in this desktop build. Update the SyncBiz desktop app to use them.")}
        </p>
      ) : null}
      {shownError ? <p className="text-[11px] text-rose-400">{shownError}</p> : null}
    </div>
  );
}

/** Music folder — persists immediately after pick; no Save button. */
export function DesktopLocalMusicSettingsCard() {
  const tr = useTr();
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
        // Re-fetch the SAFE snapshot (displayLabel, no raw path) instead of
        // storing result.path — the raw location must never reach the UI state.
        const safe = api?.getMusicFolder ? await api.getMusicFolder() : { path: result.path };
        setMusicFolder(safe ?? { path: result.path });
        setFolderStatus("Connected");
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
        {tr("Open SyncBiz in the desktop app to choose a local music folder.")}
      </p>
    );
  }

  if (load === "idle" || load === "loading") {
    return <p className="text-xs text-slate-500">{tr("Loading…")}</p>;
  }

  const musicFolderReady = musicFolderApiAvailable();
  const isOn = Boolean(musicFolder.path);
  /* PRIVACY: never expose the raw path/location. Managed bank → generic label;
     a user-chosen folder → its NAME only (displayLabel = basename, no drive). */
  const connectedLabel = musicFolder.isPlaylistProLibrary
    ? tr("PlayItPro managed bank")
    : (musicFolder.displayLabel ?? tr("Local folder"));

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">{tr("PlayItPro Local Library")}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            {musicFolderReady
              ? tr("Play music stored on this machine. On managed PlayItPro machines the library connects automatically — the file location is never shown.")
              : tr("Update the SyncBiz desktop app to enable this control.")}
          </p>
        </div>
        {/* ON/OFF toggle — ON links the local library, OFF disconnects it. */}
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-label={tr("PlayItPro Local Library")}
          disabled={!musicFolderReady || busy != null}
          onClick={isOn ? onClearFolder : onPickFolder}
          className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
            isOn ? "bg-emerald-500/90" : "bg-slate-700/80"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
              isOn ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Status — a safe label, NEVER a path */}
      <div className="flex items-center gap-2 rounded-lg border border-slate-800/70 bg-slate-950/50 px-3 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${isOn ? "bg-emerald-400" : "bg-slate-600"}`} aria-hidden />
        <span className="min-w-0 truncate text-xs text-slate-300">
          {isOn ? `${tr("Connected")} · ${connectedLabel}` : tr("Off — no local library")}
        </span>
      </div>

      {/* Link your own music folder (customer-selectable) */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onPickFolder}
          disabled={!musicFolderReady || busy === "pick"}
          className="rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50"
        >
          {isOn ? tr("Change my music folder") : tr("Link my music folder")}
        </button>
        {isOn ? (
          <button
            type="button"
            onClick={onClearFolder}
            disabled={!musicFolderReady || busy === "clear"}
            className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100 disabled:opacity-50"
          >
            {tr("Disconnect")}
          </button>
        ) : null}
      </div>
      {folderStatus ? <p className="text-[11px] text-emerald-400/90">{tr(folderStatus)}</p> : null}
      {!musicFolderReady ? (
        <p className="text-[11px] text-amber-400/90">
          Some controls are unavailable in this desktop build. Update the SyncBiz desktop app to use them.
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-rose-400">{error}</p> : null}
    </div>
  );
}
