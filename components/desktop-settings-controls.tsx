"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PLAYLISTPRO_LIBRARY_DISPLAY_NAME,
  redactPathForUserDisplay,
} from "@/lib/playlistpro-paths";
import {
  isOperatorToolsEnabled,
  setOperatorToolsEnabled,
} from "@/lib/operator-tools";

type MusicLibrarySourceUi = {
  id: string;
  kind: "playlistpro" | "additional";
  path: string;
  displayLabel: string;
  status: "ready" | "missing" | "unconfigured";
  trackCount: number | null;
  lastScanIso: string | null;
  removable: boolean;
};

type MusicLibrarySourcesUi = {
  playlistPro: MusicLibrarySourceUi;
  additional: MusicLibrarySourceUi[];
};

function formatLastScanTime(iso: string | null, he: boolean): string {
  if (!iso) return he ? "טרם נסרק" : "Not scanned yet";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return he ? `נסרק לאחרונה: ${d.toLocaleString("he-IL")}` : `Last scan: ${d.toLocaleString()}`;
}

function localeIsHebrew(): boolean {
  if (typeof navigator === "undefined") return false;
  const lang = (navigator.language || "").toLowerCase();
  return lang.startsWith("he");
}

type AutoStartState = {
  enabled: boolean;
  supported: boolean;
};

type MusicFolderSnapshot = {
  path: string | null;
  displayLabel?: string | null;
  isPlaylistProLibrary?: boolean;
};

type MetadataBankUiStatus = {
  folderPath: string | null;
  lastImport: {
    importedAt: string;
    filesScanned: number;
    rowsRead: number;
    matched: number;
    updated: number;
    missingOnDisk: number;
  } | null;
};

function formatMetadataBankSummary(status: MetadataBankUiStatus, isOperator: boolean): string | null {
  const folder = status.folderPath?.trim();
  if (!folder && !status.lastImport) return null;
  const lines: string[] = [];
  if (folder) {
    lines.push(`Metadata: ${redactPathForUserDisplay(folder, { isOperator })}`);
  }
  if (status.lastImport) {
    const d = new Date(status.lastImport.importedAt);
    const when = Number.isFinite(d.getTime()) ? d.toLocaleString() : status.lastImport.importedAt;
    lines.push(
      `Last import ${when} — ${status.lastImport.filesScanned} file(s), ${status.lastImport.rowsRead} rows, ${status.lastImport.matched} matched, ${status.lastImport.updated} updated, ${status.lastImport.missingOnDisk} missing on disk.`,
    );
  }
  return lines.join(" ");
}

function metadataBankApiAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const api = window.syncbizDesktop;
  return Boolean(
    api?.getLocalMetadataBank &&
      api?.pickLocalMetadataBankFolder &&
      api?.refreshLocalMetadataBank,
  );
}

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

/** Toggle operator/advanced maintenance tools (metadata bank, path overrides). */
export function DesktopOperatorToolsToggle() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isOperatorToolsEnabled());
  }, []);

  if (!isInElectron()) return null;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-slate-200">Operator / advanced tools</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Shows PlaylistPro metadata maintenance and path overrides. Off by default for normal users.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => {
          const next = !enabled;
          setOperatorToolsEnabled(next);
          setEnabled(next);
        }}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
          enabled ? "bg-amber-500/80" : "bg-slate-700"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function librarySourcesApiAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const api = window.syncbizDesktop;
  return Boolean(
    api?.listMusicLibrarySources &&
      api?.addAdditionalMusicFolder &&
      api?.removeAdditionalMusicFolder &&
      api?.scanMusicLibrary,
  );
}

/**
 * Local Music — protected PlaylistPro Library + user-added Additional Folders
 * (Winamp Watch Folders model). Normal users can add/remove ONLY extra folders;
 * PlaylistPro is shown as a read-only source with no remove/edit option.
 * Operator tools (path override, metadata bank) live in the separate
 * `DesktopPlaylistProOperatorCard` and stay off by default.
 */
export function DesktopLocalMusicSettingsCard() {
  const [load, setLoad] = useState<LoadState>("idle");
  const [musicFolder, setMusicFolder] = useState<MusicFolderSnapshot>({ path: null });
  const [sources, setSources] = useState<MusicLibrarySourcesUi | null>(null);
  const [operatorMode, setOperatorMode] = useState(false);
  const [busy, setBusy] = useState<
    | { op: "pick" | "clear" | "scan" | "add" }
    | { op: "remove"; id: string }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [folderStatus, setFolderStatus] = useState<string | null>(null);

  const he = useMemo(() => localeIsHebrew(), []);

  useEffect(() => {
    setOperatorMode(isOperatorToolsEnabled());
  }, []);

  const reloadSources = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.listMusicLibrarySources) return;
    try {
      const next = await api.listMusicLibrarySources();
      setSources(next);
    } catch {
      // ignore — UI will keep last known state
    }
  }, []);

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
        if (api?.listMusicLibrarySources) {
          const s = await api.listMusicLibrarySources();
          if (cancelled) return;
          setSources(s);
        }
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
    setBusy({ op: "pick" });
    setError(null);
    setFolderStatus(null);
    try {
      const result = await api.pickMusicFolder();
      if (result.status === "ok") {
        const m = api.getMusicFolder ? await api.getMusicFolder() : { path: result.path };
        setMusicFolder(m ?? { path: result.path });
        await reloadSources();
        setFolderStatus(he ? "נשמר אוטומטית" : "Saved automatically");
      } else if (result.status === "error") {
        setError(result.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [he, reloadSources]);

  const onClearFolder = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.clearMusicFolder) return;
    setBusy({ op: "clear" });
    setError(null);
    setFolderStatus(null);
    try {
      const next = await api.clearMusicFolder();
      setMusicFolder(next);
      await reloadSources();
      setFolderStatus(he ? "התיקייה נוקתה" : "Folder cleared");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [he, reloadSources]);

  const onAddFolder = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.addAdditionalMusicFolder) return;
    setBusy({ op: "add" });
    setError(null);
    setFolderStatus(null);
    try {
      const result = await api.addAdditionalMusicFolder();
      if (result.status === "ok") {
        setFolderStatus(he ? "תיקייה נוספה" : "Folder added");
        await reloadSources();
      } else if (result.status === "already_added") {
        setError(he ? "התיקייה כבר מחוברת." : "Folder is already connected.");
      } else if (result.status === "protected") {
        setError(
          he
            ? "לא ניתן להוסיף את תיקיית PlaylistPro המוגנת מכאן."
            : "Cannot add the protected PlaylistPro folder here.",
        );
      } else if (result.status === "error") {
        setError(result.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [he, reloadSources]);

  const onRemoveFolder = useCallback(
    async (source: MusicLibrarySourceUi) => {
      if (!source.removable) {
        setError(
          he
            ? "תיקיית PlaylistPro מוגנת ולא ניתן להסירה כאן."
            : "PlaylistPro folder is protected and cannot be removed here.",
        );
        return;
      }
      const api = window.syncbizDesktop;
      if (!api?.removeAdditionalMusicFolder) return;
      setBusy({ op: "remove", id: source.id });
      setError(null);
      setFolderStatus(null);
      try {
        const res = await api.removeAdditionalMusicFolder(source.path);
        if (res.status === "ok") {
          setFolderStatus(he ? "תיקייה הוסרה" : "Folder removed");
          await reloadSources();
        } else if (res.status === "protected") {
          setError(
            he
              ? "תיקיית PlaylistPro מוגנת ולא ניתן להסירה."
              : "PlaylistPro folder is protected and cannot be removed.",
          );
        } else if (res.status === "not_found") {
          await reloadSources();
        } else if (res.status === "error") {
          setError(res.message);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [he, reloadSources],
  );

  const onScanNow = useCallback(async () => {
    const api = window.syncbizDesktop;
    if (!api?.scanMusicLibrary) return;
    setBusy({ op: "scan" });
    setError(null);
    setFolderStatus(null);
    try {
      const res = await api.scanMusicLibrary();
      if (res.status === "ok") {
        const total = res.sources.reduce((sum, s) => sum + (s.filesIndexed ?? 0), 0);
        setFolderStatus(
          he
            ? `סריקה הסתיימה. ${total} קבצים אונדקסו.`
            : `Scan complete. ${total} files indexed.`,
        );
        await reloadSources();
      } else if (res.status === "error") {
        setError(res.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [he, reloadSources]);

  if (load === "web-only") {
    return (
      <p className="text-xs text-slate-500">
        {he
          ? "ניהול מוזיקה מקומית זמין באפליקציית הדסקטופ."
          : "Open SyncBiz in the desktop app to manage local music sources."}
      </p>
    );
  }

  if (load === "idle" || load === "loading") {
    return <p className="text-xs text-slate-500">{he ? "טוען…" : "Loading…"}</p>;
  }

  const musicFolderReady = musicFolderApiAvailable();
  const sourcesReady = librarySourcesApiAvailable();
  const connected = Boolean(musicFolder.path?.trim());
  const displayName =
    musicFolder.displayLabel?.trim() ||
    (connected ? PLAYLISTPRO_LIBRARY_DISPLAY_NAME : he ? "לא מחובר" : "Not connected");
  const showPathField = operatorMode && connected;
  const playlistPro = sources?.playlistPro ?? null;
  const additional = sources?.additional ?? [];
  const scanBusy = busy?.op === "scan";
  const addBusy = busy?.op === "add";

  return (
    <div className="space-y-4">
      {/* PROTECTED PlaylistPro card — read-only for normal users */}
      <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-slate-200">
              {he ? "ספריית PlaylistPro" : "PlaylistPro Library"}
              <span className="ms-2 text-[10px] font-normal text-slate-500">
                {he ? "ברירת מחדל • מוגן" : "Default • Protected"}
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {playlistPro?.status === "ready"
                ? he
                  ? "מקור מוגן זה מתחזק על-ידי SyncBiz ולא ניתן לעריכה רגילה."
                  : "Protected source maintained by SyncBiz — no normal edits."
                : he
                  ? "ספריית PlaylistPro לא נמצאה. עדכן את אפליקציית הדסקטופ או פנה לאופרטור."
                  : "PlaylistPro library was not found. Update the desktop app or contact your operator."}
            </p>
          </div>
          <div className="shrink-0">
            <span
              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                playlistPro?.status === "ready"
                  ? "bg-emerald-500/10 text-emerald-300"
                  : playlistPro?.status === "missing"
                    ? "bg-rose-500/10 text-rose-300"
                    : "bg-slate-700/50 text-slate-400"
              }`}
            >
              {playlistPro?.status === "ready"
                ? he
                  ? "מוכן"
                  : "Ready"
                : playlistPro?.status === "missing"
                  ? he
                    ? "חסר"
                    : "Missing"
                  : he
                    ? "לא מוגדר"
                    : "Not configured"}
            </span>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          {displayName}
          {playlistPro?.trackCount != null ? (
            <span className="ms-2 text-slate-500">
              {he ? `· ${playlistPro.trackCount} שירים` : `· ${playlistPro.trackCount} tracks`}
            </span>
          ) : null}
          <span className="ms-2 text-slate-500">
            · {formatLastScanTime(playlistPro?.lastScanIso ?? null, he)}
          </span>
        </p>
        {showPathField ? (
          <input
            readOnly
            tabIndex={-1}
            aria-readonly
            value={musicFolder.path ?? ""}
            className="mt-2 w-full cursor-default rounded-lg border border-amber-500/25 bg-slate-950/80 px-3 py-2 font-mono text-[10px] text-amber-100/70 outline-none"
            title={he ? "אופרטור בלבד — נתיב מלא" : "Operator only — absolute path"}
          />
        ) : null}
        {operatorMode ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onPickFolder}
              disabled={!musicFolderReady || busy?.op === "pick"}
              className="rounded-lg border border-amber-600/40 bg-amber-900/15 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition hover:border-amber-500 disabled:opacity-50"
            >
              {connected
                ? he
                  ? "עקוף נתיב (אופרטור)"
                  : "Override path (operator)"
                : he
                  ? "בחר נתיב (אופרטור)"
                  : "Choose path (operator)"}
            </button>
            {connected ? (
              <button
                type="button"
                onClick={onClearFolder}
                disabled={!musicFolderReady || busy?.op === "clear"}
                className="rounded-lg border border-slate-700 bg-slate-900/40 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100 disabled:opacity-50"
              >
                {he ? "נקה עקיפה" : "Clear override"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Additional folders — Winamp Watch Folders model */}
      <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-slate-200">
              {he ? "תיקיות נוספות" : "Additional folders"}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {he
                ? "הוסף תיקיות מוזיקה נוספות שיופיעו בחיפושי AI ובדפדוף."
                : "Add extra music folders to include them in AI playlist search and browse."}
            </p>
          </div>
          <button
            type="button"
            onClick={onAddFolder}
            disabled={!sourcesReady || addBusy}
            className="shrink-0 rounded-lg border border-emerald-600/40 bg-emerald-900/15 px-2.5 py-1 text-[11px] font-medium text-emerald-100 transition hover:border-emerald-500 disabled:opacity-50"
          >
            {addBusy ? (he ? "פותח…" : "Opening…") : he ? "הוסף תיקייה" : "Add folder"}
          </button>
        </div>
        {additional.length === 0 ? (
          <p className="mt-2 text-[11px] text-slate-500">
            {he ? "אין תיקיות נוספות עדיין." : "No additional folders yet."}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {additional.map((src) => {
              const removingThis = busy?.op === "remove" && busy.id === src.id;
              return (
                <li
                  key={src.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-slate-800/60 bg-slate-950/60 px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-slate-200" title={operatorMode ? src.path : src.displayLabel}>
                      {src.displayLabel}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      <span
                        className={`me-1.5 inline-flex items-center rounded px-1 py-0.5 ${
                          src.status === "ready"
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-rose-500/10 text-rose-300"
                        }`}
                      >
                        {src.status === "ready" ? (he ? "מוכן" : "Ready") : he ? "חסר" : "Missing"}
                      </span>
                      {src.trackCount != null ? (
                        <span className="me-1.5">
                          {he ? `${src.trackCount} שירים` : `${src.trackCount} tracks`}
                        </span>
                      ) : null}
                      <span>· {formatLastScanTime(src.lastScanIso, he)}</span>
                      {operatorMode ? (
                        <span className="ms-2 text-amber-300/70" title={src.path}>
                          {src.path}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveFolder(src)}
                    disabled={removingThis}
                    className="shrink-0 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[10px] font-medium text-slate-300 transition hover:border-rose-600/40 hover:text-rose-200 disabled:opacity-50"
                  >
                    {removingThis ? (he ? "מסיר…" : "Removing…") : he ? "הסר" : "Remove"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onScanNow}
            disabled={!sourcesReady || scanBusy}
            className="rounded-lg border border-cyan-600/40 bg-cyan-900/15 px-2.5 py-1 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-500 disabled:opacity-50"
          >
            {scanBusy ? (he ? "סורק…" : "Scanning…") : he ? "סרוק עכשיו" : "Scan now"}
          </button>
          <button
            type="button"
            onClick={onScanNow}
            disabled={!sourcesReady || scanBusy}
            className="rounded-lg border border-slate-700 bg-slate-900/40 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100 disabled:opacity-50"
          >
            {he ? "רענן ספרייה" : "Rescan library"}
          </button>
        </div>
      </div>

      {folderStatus ? <p className="text-[11px] text-emerald-400/90">{folderStatus}</p> : null}
      {!sourcesReady ? (
        <p className="text-[11px] text-amber-400/90">
          {he
            ? "כמה פקדים אינם זמינים בגרסת דסקטופ זו. עדכן את אפליקציית SyncBiz."
            : "Some controls are unavailable in this desktop build. Update the SyncBiz desktop app to use them."}
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-rose-400">{error}</p> : null}
    </div>
  );
}

/** PlaylistPro metadata bank (Tag&Rename XLSX) — operator only; never uploaded. */
export function DesktopPlaylistProOperatorCard() {
  const [operatorMode, setOperatorMode] = useState(false);
  const [load, setLoad] = useState<LoadState>("idle");
  const [bankStatus, setBankStatus] = useState<MetadataBankUiStatus>({ folderPath: null, lastImport: null });
  const [busy, setBusy] = useState<"pick" | "refresh" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOperatorMode(isOperatorToolsEnabled());
  }, []);

  const loadBankStatus = useCallback(async () => {
    const api = window.syncbizDesktop?.getLocalMetadataBank;
    if (typeof api !== "function") return;
    try {
      const st = await api();
      setBankStatus({
        folderPath: st.folderPath,
        lastImport: st.lastImport
          ? {
              importedAt: st.lastImport.importedAt,
              filesScanned: st.lastImport.filesScanned,
              rowsRead: st.lastImport.rowsRead,
              matched: st.lastImport.matched,
              updated: st.lastImport.updated,
              missingOnDisk: st.lastImport.missingOnDisk,
            }
          : null,
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!isInElectron() || !operatorMode) {
      setLoad(operatorMode ? "ready" : "web-only");
      return;
    }
    let cancelled = false;
    setLoad("loading");
    void (async () => {
      await loadBankStatus();
      if (!cancelled) setLoad("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [operatorMode, loadBankStatus]);

  const onPickBankFolder = useCallback(async () => {
    const api = window.syncbizDesktop?.pickLocalMetadataBankFolder;
    if (typeof api !== "function") return;
    setBusy("pick");
    setFlash(null);
    setError(null);
    try {
      const res = await api();
      if (res.status === "ok") {
        await loadBankStatus();
        setFlash("Metadata bank folder saved.");
      } else if (res.status === "error") {
        setError(res.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [loadBankStatus]);

  const onRefreshBank = useCallback(async () => {
    const api = window.syncbizDesktop?.refreshLocalMetadataBank;
    if (typeof api !== "function") return;
    setBusy("refresh");
    setFlash(null);
    setError(null);
    try {
      const res = await api();
      if (res.status === "error") {
        setError(res.message);
        return;
      }
      await loadBankStatus();
      setFlash(
        `${res.filesScanned} file(s), ${res.rowsRead} rows, ${res.matched} matched, ${res.updated} updated, ${res.missingOnDisk} missing on disk.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [loadBankStatus]);

  if (!operatorMode) return null;
  if (!isInElectron()) {
    return <p className="text-xs text-slate-500">Desktop app required for PlaylistPro metadata tools.</p>;
  }
  if (!metadataBankApiAvailable()) {
    return (
      <p className="text-[11px] text-amber-400/90">
        Update SyncBiz Desktop to refresh the PlaylistPro metadata catalog.
      </p>
    );
  }
  if (load === "loading" || load === "idle") {
    return <p className="text-xs text-slate-500">Loading…</p>;
  }

  const summary = formatMetadataBankSummary(bankStatus, true);

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-slate-500">
        Hidden Tag&Rename XLSX layer for PlaylistPro. Scans merge into the local snapshot for search and DJ
        Creator — never uploaded, never shown as playlists.
      </p>
      {summary ? (
        <p className="rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
          {summary}
        </p>
      ) : (
        <p className="text-xs text-slate-500">No metadata import yet. Refresh to scan the default bank folder.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onPickBankFolder()}
          className="rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:border-slate-500 disabled:opacity-50"
        >
          {busy === "pick" ? "Opening…" : "Set metadata folder"}
        </button>
        <button
          type="button"
          disabled={busy !== null || !bankStatus.folderPath}
          onClick={() => void onRefreshBank()}
          className="rounded-lg border border-amber-600/50 bg-amber-900/25 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:border-amber-500/60 disabled:opacity-50"
        >
          {busy === "refresh" ? "Refreshing…" : "Refresh metadata bank"}
        </button>
      </div>
      {flash ? <p className="text-[11px] text-emerald-400/90">{flash}</p> : null}
      {error ? <p className="text-[11px] text-rose-400">{error}</p> : null}
    </div>
  );
}
