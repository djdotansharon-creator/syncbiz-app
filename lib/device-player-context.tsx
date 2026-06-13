"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { getDeviceId, initDeviceId } from "@/lib/device-id";
import { usePlayback } from "@/lib/playback-provider";
import { useRemoteControlWs } from "@/lib/remote-control/ws-client";
import { SecondaryDesktopModal } from "@/components/secondary-desktop-modal";
import { GuestRecommendationModal } from "@/components/guest-recommendation-modal";
import { urlToUnifiedSource } from "@/lib/remote-control/url-to-source";
import { hydratePlaySourceFromPayload } from "@/lib/remote-control/hydrate-play-source";
import { payloadToUnifiedSource } from "@/lib/remote-control/payload-to-source";
import { unifiedSourceToPayload } from "@/lib/remote-control/source-to-payload";
import { masterPlaybackDiag } from "@/lib/master-playback-diag";
import { createPlayNextFromUnifiedSource } from "@/lib/play-next";
import type { UnifiedSource } from "@/lib/source-types";
import {
  nextCommandId,
  playSourceDedupeKey,
  isTransportCommand,
  REMOTE_COMMAND_TIMEOUT_MS,
  TRANSPORT_DEBOUNCE_MS,
  type TrackedRemoteCommand,
} from "@/lib/remote-control/command-tracker";
import { fetchUnifiedSourcesWithFallback } from "@/lib/unified-sources-client";
import { playbackToStationState } from "@/lib/remote-control/playback-to-state";
import type { RemoteCommand, PlaySourcePayload, StationPlaybackState, DeviceMode, GuestRecommendationPayload } from "@/lib/remote-control/types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { getPlaylistSessionTracks } from "@/lib/playback-provider";
import { deviceModeAllowsLocalPlayback } from "@/lib/device-mode-guard";
import { getAutoMix, setAutoMix, onAutoMixChanged } from "@/lib/mix-preferences";
import { useMobileRole } from "@/lib/mobile-role-context";
import { isStreamerDeviceMode } from "@/lib/streamer-device-mode";
import {
  hasStreamerDeviceToken,
  readStreamerDeviceBranchId,
  readStreamerDeviceToken,
} from "@/lib/streamer-device-client";

type DevicePlayerContextValue = {
  /** True when this tab registers as a branch WS device (see `resolveDeviceRoleActive`). */
  isActive: boolean;
  /** True only when authenticated and connected to branch control. Hide MASTER/CONTROL/Guest UI when false. */
  isBranchConnected: boolean;
  deviceId: string | null;
  status: "connecting" | "connected" | "disconnected" | "error";
  deviceMode: DeviceMode;
  masterDeviceId: string | null;
  /** True when this device opened as CONTROL because another MASTER already exists. */
  hasExistingMaster: boolean;
  /** Remote state from master (for CONTROL mode display). */
  masterState: StationPlaybackState | null;
  masterConfirmOpen: boolean;
  setMasterConfirmOpen: (open: boolean) => void;
  /** Report position/duration from MASTER AudioPlayer for sync to CONTROL. */
  reportPosition: (position: number, duration: number) => void;
  sendSetMaster: () => void;
  sendSetControl: () => void;
  /** Send command to master (when in CONTROL mode). Returns commandId when sent. */
  sendCommandToMaster: (
    command: RemoteCommand,
    payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number; value?: boolean; trackIndex?: number },
  ) => string | null;
  /** Play source locally (MASTER) or send to master (CONTROL). */
  playSourceOrSend: (source: UnifiedSource, trackIndex?: number) => void;
  /** Append Play Next on MASTER or send QUEUE_NEXT when CONTROL. */
  queueNextOrSend: (source: UnifiedSource) => void;
  queueNextFromPathsOrSend: (paths: string[]) => void;
  queueNextFromUrlsOrSend: (urls: string[]) => void;
  /** Play/pause/stop/next/prev - local when MASTER, send to master when CONTROL. */
  playOrSend: () => void;
  pauseOrSend: () => void;
  stopOrSend: () => void;
  nextOrSend: () => void;
  prevOrSend: () => void;
  seekOrSend: (seconds: number) => void;
  setVolumeOrSend: (value: number) => void;
  /** Shuffle is MASTER-controlled; CONTROL sends explicit command and waits for STATE_UPDATE. */
  setShuffleOrSend: (value: boolean) => void;
  /** AutoMix is MASTER-controlled; CONTROL sends explicit command and waits for STATE_UPDATE. */
  setAutoMixOrSend: (value: boolean) => void;
  /** Session code for guest recommendations. Operator shares /guest?code=XXX */
  sessionCode: string | null;
  /** Full guest recommendation link for sharing */
  guestLink: string | null;
  /**
   * Plain browser on normal app routes (not /player, /remote-player): observer/controller only —
   * no branch device socket and no local execution ownership (see `deviceModeAllowsLocalPlayback`).
   */
  isObserverOnlyBrowser: boolean;
  /**
   * `/mobile/...` + role "player": this tab should play through the in-app engine on the phone even
   * if the branch device is CONTROL (station MASTER elsewhere). Not the same as `deviceMode === "MASTER"`.
   */
  isMobileLocalPlayback: boolean;
  /** GOtv / Android TV dedicated branch player (`/streamer`). */
  isStreamerDevice: boolean;
  /** CONTROL: user-visible remote command status (loading / error). */
  remoteCommandMessage: string | null;
  /** CONTROL: true while a PLAY_SOURCE is in flight to MASTER. */
  isPlaySourceRemotePending: boolean;
  /** CONTROL: per-transport button pending (only that control is "busy"). */
  isRemoteCommandPending: (command: RemoteCommand) => boolean;
};

const DevicePlayerContext = createContext<DevicePlayerContextValue | null>(null);

/**
 * Browser-only: dedicated player surfaces that may output branch audio locally when MASTER (see
 * `deviceModeAllowsLocalPlayback` — gated to these routes only, not `/settings`).
 *
 * `/mobile` is eligible because the mobile surface has an explicit Player mode where the phone
 * itself owns playback. The mobile role context (`lib/mobile-role-context.tsx`) gates whether
 * the user is in Controller vs Player mode; eligibility here is only about whether local
 * playback is physically allowed on this route, not about which mode is active.
 */
const ELIGIBLE_BROWSER_PLAYER_ROUTES = ["/player", "/remote-player", "/streamer", "/sources", "/mobile"] as const;

function isEligibleBrowserPlayerRoute(pathname: string): boolean {
  return ELIGIBLE_BROWSER_PLAYER_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/**
 * Browser: operator pages that need a branch `device` socket (MASTER/CONTROL in Settings, MY LINK in
 * Sources rail, etc.) but must not own local branch audio — gated separately via `isEligibleBrowserPlayerRoute`.
 */
function isBrowserBranchControlsOnlyRoute(pathname: string): boolean {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return true;
  if (pathname === "/sources" || pathname.startsWith("/sources/")) return true;
  if (pathname === "/library" || pathname.startsWith("/library/")) return true;
  return false;
}

/** Browser tabs that open a branch device socket (player surfaces + branch-controls pages; not /dashboard, /logs, …). */
function isBrowserBranchUiDeviceRoute(pathname: string): boolean {
  return isEligibleBrowserPlayerRoute(pathname) || isBrowserBranchControlsOnlyRoute(pathname);
}

function readSyncBizElectronRenderer(): boolean {
  return typeof window !== "undefined" && Boolean((window as Window & { syncbizDesktop?: unknown }).syncbizDesktop);
}

/**
 * When `true`, this tab holds the branch device WebSocket (`role: device`) and participates in MASTER/CONTROL.
 * - Electron (desktop branch player): all routes except /mobile.
 * - Plain browser: player surfaces + `/settings` (branch controls / MY LINK); other routes stay observer-only (no WS device).
 */
function resolveDeviceRoleActive(pathname: string, isElectronShell: boolean | null): boolean {
  if (pathname === "/mobile") return false;
  if (isElectronShell === true) return true;
  if (isElectronShell === false) return isBrowserBranchUiDeviceRoute(pathname);
  // SSR: no `window` — treat like browser until client mounts (see lazy `isElectronShell` init).
  return isBrowserBranchUiDeviceRoute(pathname);
}

export function useDevicePlayer() {
  const ctx = useContext(DevicePlayerContext);
  return ctx;
}

export function DevicePlayerProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { mobileRole } = useMobileRole();
  const isMobileLocalPlayback =
    (pathname === "/mobile" || pathname?.startsWith("/mobile/")) && mobileRole === "player";
  const isStreamerDevice = isStreamerDeviceMode(pathname);
  /** Server: unknown. Client: read immediately so Electron is not treated as `null` until after first paint (that hid Settings branch UI). */
  const [isElectronShell, setIsElectronShell] = useState<boolean | null>(() =>
    typeof window === "undefined" ? null : readSyncBizElectronRenderer(),
  );

  useEffect(() => {
    setIsElectronShell(readSyncBizElectronRenderer());
  }, []);

  const isActive = resolveDeviceRoleActive(pathname, isElectronShell);
  const deviceId = isActive ? getDeviceId() : null;

  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [streamerPaired, setStreamerPaired] = useState(false);
  const [streamerBranchId, setStreamerBranchId] = useState("default");
  const [wsToken, setWsToken] = useState<string | null>(null);
  const [tokenRefreshTrigger, setTokenRefreshTrigger] = useState(0);
  const [secondaryDesktopModalOpen, setSecondaryDesktopModalOpen] = useState(false);
  const [pendingGuestRecommendation, setPendingGuestRecommendation] = useState<GuestRecommendationPayload | null>(null);

  /** Dev-only: dedupe console noise — log when branch/guest diagnostic snapshot changes. */
  const branchDiagSnapshotRef = useRef<string>("");

  useEffect(() => {
    if (isStreamerDevice) {
      setStreamerPaired(hasStreamerDeviceToken());
      setStreamerBranchId(readStreamerDeviceBranchId());
      setAuthLoaded(true);
      return;
    }
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: { email?: string | null }) => {
        setUserId((data?.email ?? "").trim() || "");
        setAuthLoaded(true);
      })
      .catch(() => {
        setUserId("");
        setAuthLoaded(true);
      });
  }, [isStreamerDevice]);

  useEffect(() => {
    if (!isActive || !authLoaded) {
      setWsToken(null);
      return;
    }

    if (isStreamerDevice) {
      const deviceToken = readStreamerDeviceToken();
      if (!deviceToken) {
        setWsToken(null);
        return;
      }
      let cancelled = false;
      const fetchStreamerToken = (retry = false) => {
        fetch("/api/streamer/ws-token", {
          headers: { Authorization: `Bearer ${deviceToken}` },
        })
          .then((r) => {
            if (cancelled) return;
            if (r.status === 401) {
              setWsToken(null);
              setStreamerPaired(false);
              return;
            }
            if (!r.ok && !retry) {
              setTimeout(() => fetchStreamerToken(true), 1000);
              return;
            }
            if (!r.ok) return;
            return r.json();
          })
          .then((data: { token?: string; branchId?: string } | undefined) => {
            if (cancelled || !data?.token) return;
            setWsToken(data.token);
            if (data.branchId) {
              setStreamerBranchId(data.branchId);
            }
          })
          .catch(() => {
            if (!cancelled) setWsToken(null);
          });
      };
      fetchStreamerToken();
      return () => {
        cancelled = true;
      };
    }

    if (!(userId ?? "").trim()) {
      setWsToken(null);
      return;
    }
    let cancelled = false;
    if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
      console.info("[SyncBiz WS client] token refresh requested", { role: "device" });
    }
    const fetchToken = (retry = false) => {
      fetch("/api/auth/ws-token")
        .then((r) => {
          if (cancelled) return;
          if (r.status === 401) {
            setWsToken(null);
            if (process.env.NODE_ENV === "development") {
              console.info("[SyncBiz WS client] token refresh failure (401)");
            }
            return;
          }
          if (!r.ok && !retry) {
            setTimeout(() => fetchToken(true), 1000);
            return;
          }
          if (!r.ok) return;
          return r.json();
        })
        .then((data: { token?: string } | undefined) => {
          if (cancelled) return;
          if (!data?.token) {
            if (process.env.NODE_ENV === "development") {
              console.info("[SyncBiz WS client] token refresh failure (no token)");
            }
            return;
          }
          setWsToken(data.token);
          if (process.env.NODE_ENV === "development") {
            console.info("[SyncBiz WS client] token refresh success", { role: "device" });
          }
        })
        .catch(() => {
          if (cancelled) return;
          setWsToken(null);
          if (process.env.NODE_ENV === "development") {
            console.info("[SyncBiz WS client] token refresh failure (network)");
          }
        });
    };
    fetchToken();
    return () => { cancelled = true; };
  }, [isActive, authLoaded, userId, isStreamerDevice, tokenRefreshTrigger]);

  const effectiveUserId = isStreamerDevice
    ? streamerPaired
      ? "streamer-device"
      : ""
    : (userId ?? "").trim();

  useEffect(() => {
    if (!isActive || typeof document === "undefined" || typeof window === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setTokenRefreshTrigger((k) => k + 1);
    };
    const onFocus = () => setTokenRefreshTrigger((k) => k + 1);
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setTokenRefreshTrigger((k) => k + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [isActive]);
  const {
    play,
    pause,
    stop,
    stopForControlHandoff,
    next,
    prev,
    playSource,
    setVolume,
    seekTo,
    shuffle,
    setShuffle,
    status: playStatus,
    currentSource,
    currentPlaylist,
    currentTrackIndex,
    queue,
    queueIndex,
    volume,
    isRestoring,
    playNextQueue,
    addPlayNextFromPaths,
    addPlayNextFromUrls,
    addPlayNextSources,
  } = usePlayback();
  const [masterConfirmOpen, setMasterConfirmOpen] = useState(false);
  const [masterState, setMasterState] = useState<StationPlaybackState | null>(null);
  const [autoMixState, setAutoMixState] = useState<boolean>(() => getAutoMix());
  const lastConnectedModeRef = useRef<DeviceMode | null>(null);
  const prevEffectiveModeRef = useRef<DeviceMode>("MASTER");
  const pendingMasterAdoptionRef = useRef(false);
  const reportedPositionRef = useRef<{ position: number; duration: number } | null>(null);
  const lastRemotePlayKeyRef = useRef<string | null>(null);
  const remotePlayInFlightRef = useRef(false);
  const sendCommandResultRef = useRef<(commandId: string, ok: boolean, error?: string) => void>(() => {});
  const trackedCommandsRef = useRef<Map<string, TrackedRemoteCommand>>(new Map());
  const playSourcePendingKeyRef = useRef<string | null>(null);
  const lastTransportSentRef = useRef<{ command: RemoteCommand; at: number } | null>(null);
  const [remoteCommandMessage, setRemoteCommandMessage] = useState<string | null>(null);
  const [pendingRemoteCommands, setPendingRemoteCommands] = useState<Set<RemoteCommand>>(() => new Set());
  const [playSourceRemotePending, setPlaySourceRemotePending] = useState(false);

  const settleTrackedCommand = useCallback(
    (commandId: string, outcome: TrackedRemoteCommand["outcome"], error?: string) => {
      const tracked = trackedCommandsRef.current.get(commandId);
      if (!tracked) return;
      tracked.outcome = outcome;
      tracked.finishedAt = Date.now();
      if (error) tracked.error = error;
      trackedCommandsRef.current.set(commandId, tracked);
      if (tracked.dedupeKey && playSourcePendingKeyRef.current === tracked.dedupeKey) {
        playSourcePendingKeyRef.current = null;
        setPlaySourceRemotePending(false);
      }
      setPendingRemoteCommands((prev) => {
        if (!prev.has(tracked.command)) return prev;
        const next = new Set(prev);
        next.delete(tracked.command);
        return next;
      });
      if (outcome === "failed" || outcome === "timeout") {
        setRemoteCommandMessage(error ?? "Command failed on streamer");
      } else if (outcome === "success" && tracked.command === "PLAY_SOURCE") {
        setRemoteCommandMessage(null);
      }
    },
    [],
  );

  const finishRemoteCommand = useCallback(
    (commandId: string | undefined, ok: boolean, error?: string) => {
      if (!commandId) return;
      sendCommandResultRef.current(commandId, ok, error);
      settleTrackedCommand(commandId, ok ? "success" : "failed", error);
      if (process.env.NODE_ENV === "development") {
        console.info("[SyncBiz:remote-cmd] master finished", { commandId, ok, error });
      }
    },
    [settleTrackedCommand],
  );

  const onCommandAck = useCallback(
    (ack: { commandId: string; masterDeviceId?: string | null; receivedAt: number }) => {
      const tracked = trackedCommandsRef.current.get(ack.commandId);
      if (tracked) {
        tracked.outcome = "ack";
        tracked.ackAt = ack.receivedAt;
        tracked.masterDeviceId = ack.masterDeviceId ?? undefined;
        trackedCommandsRef.current.set(ack.commandId, tracked);
      }
      if (process.env.NODE_ENV === "development") {
        console.info("[SyncBiz:remote-cmd] ack", ack);
      }
    },
    [],
  );

  const onCommandResult = useCallback(
    (result: { commandId: string; ok: boolean; error?: string }) => {
      settleTrackedCommand(result.commandId, result.ok ? "success" : "failed", result.error);
      if (result.ok) {
        setRemoteCommandMessage((msg) =>
          msg?.startsWith("Loading") || msg?.startsWith("Session list") ? null : msg,
        );
      }
      if (process.env.NODE_ENV === "development") {
        console.info("[SyncBiz:remote-cmd] result", result);
      }
    },
    [settleTrackedCommand],
  );

  const reportPosition = useCallback((position: number, duration: number) => {
    if (Number.isFinite(position) && Number.isFinite(duration)) {
      reportedPositionRef.current = { position, duration };
    }
  }, []);

  useEffect(() => {
    return onAutoMixChanged((v) => setAutoMixState(v));
  }, []);

  const onCommand = useCallback(
    (cmd: {
      commandId?: string;
      command: string;
      payload?: { url?: string; source?: unknown; position?: number; volume?: number; value?: boolean; trackIndex?: number };
    }) => {
      const command = cmd.command as RemoteCommand;
      masterPlaybackDiag("remote command received", {
        command,
        commandId: cmd.commandId ?? null,
        hasSource: !!cmd.payload?.source,
        hasUrl: !!cmd.payload?.url,
        trackIndex: cmd.payload?.trackIndex,
        seekPosition: cmd.payload?.position,
      });
      const finish = (ok: boolean, error?: string) => finishRemoteCommand(cmd.commandId, ok, error);
      const runSync = (fn: () => void) => {
        try {
          fn();
          finish(true);
        } catch (e) {
          finish(false, String(e));
        }
      };
      if (command === "PLAY") runSync(() => play());
      else if (command === "PAUSE") runSync(() => pause());
      else if (command === "STOP") runSync(() => stop());
      else if (command === "NEXT") {
        try {
          next();
          finishRemoteCommand(cmd.commandId, true);
        } catch (e) {
          finishRemoteCommand(cmd.commandId, false, String(e));
        }
      } else if (command === "PREV") {
        try {
          prev();
          finishRemoteCommand(cmd.commandId, true);
        } catch (e) {
          finishRemoteCommand(cmd.commandId, false, String(e));
        }
      }
      else if (command === "SET_SHUFFLE" && typeof cmd.payload?.value === "boolean") {
        runSync(() => setShuffle(cmd.payload!.value as boolean));
      }
      else if (command === "SET_AUTOMIX" && typeof cmd.payload?.value === "boolean") {
        runSync(() => setAutoMix(cmd.payload!.value as boolean));
      }
      else if (command === "SEEK" && typeof cmd.payload?.position === "number") {
        runSync(() => {
          masterPlaybackDiag("seek", { position: cmd.payload!.position });
          seekTo(cmd.payload!.position as number);
        });
      } else if (command === "QUEUE_NEXT") {
        const commandId = cmd.commandId;
        void (async () => {
          try {
            if (typeof cmd.payload?.url === "string" && cmd.payload.url.trim()) {
              addPlayNextFromUrls([cmd.payload.url.trim()]);
              finishRemoteCommand(commandId, true);
              return;
            }
            const payload = cmd.payload?.source as PlaySourcePayload | undefined;
            if (!payload) {
              finishRemoteCommand(commandId, false, "QUEUE_NEXT requires source or url");
              return;
            }
            const base = payloadToUnifiedSource(payload);
            const cloned = createPlayNextFromUnifiedSource(base);
            if (!cloned) {
              finishRemoteCommand(commandId, false, "Not playable for Play Next");
              return;
            }
            addPlayNextSources([cloned]);
            masterPlaybackDiag("QUEUE_NEXT applied", { title: cloned.title, id: cloned.id });
            finishRemoteCommand(commandId, true);
          } catch (e) {
            finishRemoteCommand(commandId, false, String(e));
          }
        })();
      } else if (command === "SET_VOLUME" && typeof cmd.payload?.volume === "number") {
        runSync(() => setVolume(Math.max(0, Math.min(100, cmd.payload!.volume as number))));
      } else if (command === "LOAD_PLAYLIST" && cmd.payload?.url) {
        runSync(() => playSource(urlToUnifiedSource(cmd.payload!.url as string)));
      } else if (command === "PLAY_SOURCE" && cmd.payload?.source) {
        const payload = cmd.payload.source as PlaySourcePayload;
        const trackIdx = typeof cmd.payload.trackIndex === "number" ? cmd.payload.trackIndex : 0;
        const commandId = cmd.commandId;
        const dedupeKey = playSourceDedupeKey(payload.id, payload.playlistId, trackIdx);
        if (
          dedupeKey === lastRemotePlayKeyRef.current &&
          currentSource?.id === payload.id &&
          currentTrackIndex === trackIdx &&
          (playStatus === "playing" || playStatus === "paused")
        ) {
          masterPlaybackDiag("PLAY_SOURCE dedupe skip", { dedupeKey, trackIdx });
          if (playStatus === "paused") {
            try {
              play();
            } catch {
              /* ignore */
            }
          }
          finishRemoteCommand(commandId, true);
          return;
        }
        if (remotePlayInFlightRef.current && dedupeKey === lastRemotePlayKeyRef.current) {
          finishRemoteCommand(commandId, true);
          return;
        }
        lastRemotePlayKeyRef.current = dedupeKey;
        remotePlayInFlightRef.current = true;
        void (async () => {
          try {
            const resolved = await hydratePlaySourceFromPayload(payload);
            const hydratedLen = resolved.playlist ? getPlaylistTracks(resolved.playlist).length : 0;
            if (process.env.NODE_ENV === "development") {
              console.info("[SyncBiz:remote-cmd] MASTER hydrated PLAY_SOURCE", {
                playlistId: payload.playlistId ?? null,
                hydratedTrackCount: hydratedLen,
                payloadSessionTracksLen: payload.sessionTracks?.length ?? 0,
              });
            }
            if (payload.playlistId && hydratedLen === 0 && (payload.sessionTracks?.length ?? 0) > 0) {
              finishRemoteCommand(commandId, false, "Failed to load playlist on streamer");
              return;
            }
            masterPlaybackDiag("PLAY_SOURCE playSource", {
              sourceId: resolved.id,
              trackIdx,
              playlistId: payload.playlistId ?? null,
            });
            playSource(resolved, trackIdx);
            finishRemoteCommand(commandId, true);
          } catch (e) {
            finishRemoteCommand(commandId, false, String(e));
          } finally {
            remotePlayInFlightRef.current = false;
          }
        })();
      }
    },
    [
      play,
      pause,
      stop,
      next,
      prev,
      playSource,
      addPlayNextFromPaths,
      addPlayNextFromUrls,
      addPlayNextSources,
      seekTo,
      setVolume,
      setShuffle,
      setAutoMix,
      finishRemoteCommand,
      currentSource?.id,
      currentTrackIndex,
      playStatus,
    ]
  );

  const onDeviceMode = useCallback(
    (mode: DeviceMode) => {
      console.log("[SyncBiz Audit] Device mode change", {
        mode,
      });
      if (mode === "CONTROL" && !isMobileLocalPlayback) {
        console.log("[SyncBiz Audit] CONTROL transition -> stopForControlHandoff (no stop-local)");
        stopForControlHandoff();
      }
    },
    [stopForControlHandoff, isMobileLocalPlayback],
  );
  const clearRemotePlayPendingIfSessionReady = useCallback((state: StationPlaybackState) => {
    const len = state.sessionTracks?.length ?? 0;
    if (len > 0) {
      setRemoteCommandMessage(null);
      setPlaySourceRemotePending(false);
      playSourcePendingKeyRef.current = null;
    }
    if (process.env.NODE_ENV === "development") {
      console.info("[SyncBiz:remote-cmd] CONTROL received STATE_UPDATE", {
        sessionTracksLen: len,
        sessionPlaylistId: state.sessionPlaylistId ?? null,
        currentTrackIndex: state.currentTrackIndex,
      });
    }
  }, []);

  const deviceModeRef = useRef<DeviceMode>("MASTER");

  const onStateUpdate = useCallback(
    (state: StationPlaybackState) => {
      if (deviceModeRef.current === "MASTER") return;
      setMasterState(state);
      clearRemotePlayPendingIfSessionReady(state);
    },
    [clearRemotePlayPendingIfSessionReady],
  );
  const onSecondaryDesktop = useCallback(() => setSecondaryDesktopModalOpen(true), []);
  const onGuestRecommendation = useCallback((rec: GuestRecommendationPayload) => setPendingGuestRecommendation(rec), []);

  const lastAuthErrorAtRef = useRef<number>(0);
  const AUTH_RETRY_BACKOFF_MS = 3000;
  const onAuthError = useCallback(() => {
    const now = Date.now();
    if (now - lastAuthErrorAtRef.current < AUTH_RETRY_BACKOFF_MS) {
      if (process.env.NODE_ENV === "development") {
        console.info("[SyncBiz WS client] reconnect due to auth expiry - retry skipped due to backoff");
      }
      return;
    }
    lastAuthErrorAtRef.current = now;
    if (process.env.NODE_ENV === "development") {
      console.info("[SyncBiz WS client] reconnect due to auth expiry", { role: "device" });
    }
    // Force the device WebSocket effect to re-run. It depends on
    // `!!options?.authToken` only, so if we only refetch a new JWT the boolean
    // stays true, the old socket (already closed by the ERROR path) is never
    // replaced, and the user is stuck in Standalone with no branch controls.
    setWsToken(null);
    setTokenRefreshTrigger((k) => k + 1);
  }, []);

  const {
    status,
    deviceMode,
    sendSetMaster,
    sendSetControl,
    sendState,
    sendCommand,
    sendCommandResult,
    masterDeviceId,
    hasExistingMaster,
    sessionCode,
    sendApproveGuestRecommend,
    sendRejectGuestRecommend,
  } = useRemoteControlWs(
    "device",
    deviceId,
    onCommand,
    onDeviceMode,
    {
      onStateUpdate,
      authToken: wsToken ?? undefined,
      onSecondaryDesktop,
      onGuestRecommendation,
      onAuthError,
      onCommandAck,
      onCommandResult,
      isDesktopApp: isElectronShell === true,
      isStreamerDevice,
      branchId: isStreamerDevice ? streamerBranchId : undefined,
    }
  );

  useEffect(() => {
    deviceModeRef.current = deviceMode;
  }, [deviceMode]);

  useEffect(() => {
    sendCommandResultRef.current = sendCommandResult;
  }, [sendCommandResult]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      for (const [commandId, tracked] of trackedCommandsRef.current) {
        if (tracked.outcome !== "pending" && tracked.outcome !== "ack") continue;
        if (now - tracked.sentAt > REMOTE_COMMAND_TIMEOUT_MS) {
          settleTrackedCommand(commandId, "timeout", "Streamer did not respond in time");
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [settleTrackedCommand]);

  const guestLink =
    typeof window !== "undefined" && sessionCode
      ? `${window.location.origin}/guest?code=${sessionCode}`
      : null;

  // Use server truth when connected. During reconnect blips, keep last connected mode to avoid
  // CONTROL<->standalone oscillation during live handoff.
  const effectiveDeviceMode =
    status === "connected"
      ? deviceMode
      : (lastConnectedModeRef.current ?? "MASTER");

  const isBranchConnected = isActive && authLoaded && !!effectiveUserId && status === "connected";

  useEffect(() => {
    if (status === "connected") {
      lastConnectedModeRef.current = deviceMode;
    }
  }, [status, deviceMode]);

  // Dedicated streamer: reclaim MASTER after connect/reconnect when demoted (cabinet player must output audio).
  // Server assigns streamer priority on REGISTER/SET_MASTER; this covers reconnect blips only.
  const streamerMasterRequestedRef = useRef(false);
  useEffect(() => {
    if (status === "disconnected" || status === "error") {
      streamerMasterRequestedRef.current = false;
    }
  }, [status]);
  useEffect(() => {
    if (!isStreamerDevice || !isActive) {
      streamerMasterRequestedRef.current = false;
      return;
    }
    if (status !== "connected" || effectiveDeviceMode === "MASTER") return;
    if (streamerMasterRequestedRef.current) return;
    streamerMasterRequestedRef.current = true;
    sendSetMaster();
  }, [isStreamerDevice, isActive, status, effectiveDeviceMode, sendSetMaster]);

  useEffect(() => {
    if (status === "connected" && effectiveDeviceMode === "MASTER") {
      streamerMasterRequestedRef.current = false;
    }
  }, [status, effectiveDeviceMode]);

  // Secondary-desktop warning is valid only while this device effectively stays in CONTROL
  // because another device is currently MASTER. Clear stale modal state after handoff/promotion.
  useEffect(() => {
    const isSelfMaster = !!deviceId && masterDeviceId === deviceId;
    const shouldShowSecondaryDesktopWarning =
      isBranchConnected &&
      effectiveDeviceMode === "CONTROL" &&
      !!masterDeviceId &&
      !isSelfMaster &&
      hasExistingMaster;

    if (!shouldShowSecondaryDesktopWarning && secondaryDesktopModalOpen) {
      setSecondaryDesktopModalOpen(false);
    }
  }, [
    secondaryDesktopModalOpen,
    isBranchConnected,
    effectiveDeviceMode,
    masterDeviceId,
    deviceId,
    hasExistingMaster,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const branchConnectedBlockers: string[] = [];
    if (!isActive) branchConnectedBlockers.push("isActive=false");
    if (!authLoaded) branchConnectedBlockers.push("authLoaded=false");
    if (!effectiveUserId) branchConnectedBlockers.push("effectiveUserId_empty");
    if (status !== "connected") branchConnectedBlockers.push(`status=${status}`);

    const guestLinkBlockers: string[] = [];
    if (!isBranchConnected) guestLinkBlockers.push("isBranchConnected=false");
    if (!sessionCode) guestLinkBlockers.push("sessionCode=null");

    const snapshot = JSON.stringify({
      pathname,
      isBranchConnected,
      status,
      sessionCode: sessionCode ?? null,
      guestLinkPresent: Boolean(guestLink),
    });
    if (snapshot === branchDiagSnapshotRef.current) return;
    branchDiagSnapshotRef.current = snapshot;

    const diag = {
      pathname,
      isActive,
      authLoaded,
      effectiveUserId: effectiveUserId || null,
      wsTokenLen: (wsToken ?? "").length,
      deviceIdPresent: Boolean(deviceId && String(deviceId).trim()),
      status,
      sessionCode: sessionCode ?? null,
      guestLink: guestLink ?? null,
      isBranchConnected,
      branchConnectedBlockers,
      guestLinkBlockers,
      /** Mirrors `components/device-mode-settings-switch.tsx`: toggle only when `ctx.isBranchConnected`. */
      settingsMasterControlRenders: isBranchConnected ? "MASTER/CONTROL switch" : "stub: Connect to branch…",
      /** Mirrors `components/guest-link-button.tsx`: button only when `isBranchConnected && guestLink`. */
      guestLinkButtonRenders: isBranchConnected && guestLink ? "Guest link visible" : "Guest link hidden",
    };

    console.info("[SyncBiz branch diagnostics]", diag);
    if (typeof window !== "undefined") {
      (window as Window & { __syncbizBranchDiag?: typeof diag }).__syncbizBranchDiag = diag;
    }
  }, [
    pathname,
    isActive,
    authLoaded,
    effectiveUserId,
    wsToken,
    deviceId,
    status,
    sessionCode,
    guestLink,
    isBranchConnected,
  ]);

  useEffect(() => {
    if (isActive) initDeviceId();
    // Do not reset `deviceModeAllowsLocalPlayback` here. The synchronous block below sets it every
    // render; resetting to `true` on unmount (e.g. React Strict Mode) left a window where async
    // playback recovery could see `true` in an observer-only browser tab and POST stop-local,
    // killing OS playback for the co-located desktop station.
  }, [isActive]);

  const isBrowserShell = typeof window !== "undefined" && !readSyncBizElectronRenderer();
  /** Browser on dashboard/settings/etc.: must not run embedded recovery / playSource (which POSTs stop-local and kills station output). */
  const isObserverOnlyBrowser = isBrowserShell && !isBrowserBranchUiDeviceRoute(pathname);

  // Block local playback whenever effective role is CONTROL (including reconnect windows that
  // keep the last connected CONTROL role), so demoted side cannot re-enter standalone output.
  // Exception: /mobile in "Player" mode — the phone is supposed to play locally (see isMobileLocalPlayback).
  // Plain browser: only real player surfaces may own local branch output; `/settings` stays non-executing.
  deviceModeAllowsLocalPlayback.current =
    (isMobileLocalPlayback || !isActive || effectiveDeviceMode === "MASTER") &&
    (!isBrowserShell || isEligibleBrowserPlayerRoute(pathname));

  // Track CONTROL -> MASTER transition so adoption can complete even if mirrored state arrives a
  // moment later than the mode flip.
  useEffect(() => {
    const prevMode = prevEffectiveModeRef.current;
    const becameMaster = prevMode !== "MASTER" && effectiveDeviceMode === "MASTER";
    prevEffectiveModeRef.current = effectiveDeviceMode;
    if (becameMaster) pendingMasterAdoptionRef.current = true;
  }, [effectiveDeviceMode]);

  // On CONTROL -> MASTER transition, adopt latest mirrored source once so promoted device
  // actually owns playback instead of showing MASTER while idle.
  useEffect(() => {
    if (isRestoring) return;
    if (!pendingMasterAdoptionRef.current || !isBranchConnected) return;

    // User/local runtime already took ownership.
    if (currentSource?.id) {
      pendingMasterAdoptionRef.current = false;
      return;
    }

    const sourceId = masterState?.currentSource?.id ?? null;
    if (!sourceId) return;

    pendingMasterAdoptionRef.current = false;
    let cancelled = false;
    fetchUnifiedSourcesWithFallback()
      .then((items) => {
        if (cancelled) return;
        const source = items.find((s) => s.id === sourceId);
        if (!source) return;
        const trackIndex = typeof masterState?.currentTrackIndex === "number" ? masterState.currentTrackIndex : 0;
        playSource(source, trackIndex);
        if (masterState?.status === "paused") {
          pause();
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    isRestoring,
    isBranchConnected,
    currentSource?.id,
    masterState?.currentSource?.id,
    masterState?.currentTrackIndex,
    masterState?.status,
    playSource,
    pause,
  ]);

  const sessionTrackCount = getPlaylistSessionTracks({
    currentSource,
    currentPlaylist,
  }).length;

  // Publish state when MASTER and connected – include position/duration for CONTROL sync
  useEffect(() => {
    if (!isActive || status !== "connected" || deviceMode !== "MASTER" || !sendState) return;
    const pd = reportedPositionRef.current;
    const state = playbackToStationState(
      playStatus,
      currentSource,
      currentTrackIndex,
      queue,
      queueIndex,
      shuffle,
      autoMixState,
      pd ? { position: pd.position, duration: pd.duration } : undefined,
      volume,
      currentPlaylist,
      playNextQueue
    );
    sendState(state);
  }, [
    isActive,
    status,
    deviceMode,
    sendState,
    playStatus,
    currentSource?.id,
    currentTrackIndex,
    queue,
    queueIndex,
    volume,
    shuffle,
    autoMixState,
    currentPlaylist?.id,
    sessionTrackCount,
    currentSource?.playlist?.tracks?.length,
    playNextQueue,
  ]);

  // When playing, send state more frequently so CONTROL progress stays in sync
  useEffect(() => {
    if (!isActive || status !== "connected" || deviceMode !== "MASTER" || playStatus !== "playing" || !sendState) return;
    const id = setInterval(() => {
      const pd = reportedPositionRef.current;
      const state = playbackToStationState(
        playStatus,
        currentSource,
        currentTrackIndex,
        queue,
        queueIndex,
        shuffle,
        autoMixState,
        pd ? { position: pd.position, duration: pd.duration } : undefined,
        volume,
        currentPlaylist,
        playNextQueue
      );
      sendState(state);
    }, 1000);
    return () => clearInterval(id);
  }, [
    isActive,
    status,
    deviceMode,
    playStatus,
    sendState,
    currentSource?.id,
    currentTrackIndex,
    queue,
    queueIndex,
    volume,
    shuffle,
    autoMixState,
    currentPlaylist?.id,
    sessionTrackCount,
    currentSource?.playlist?.tracks?.length,
    playNextQueue,
  ]);

  const useLocalDeviceTransport = effectiveDeviceMode === "MASTER" || isMobileLocalPlayback;

  const sendCommandToMaster = useCallback(
    (command: RemoteCommand, payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number; value?: boolean; trackIndex?: number }) => {
      if (useLocalDeviceTransport) return null;
      if (!masterDeviceId) {
        setRemoteCommandMessage("No MASTER device connected");
        return null;
      }
      const now = Date.now();
      if (isTransportCommand(command)) {
        const last = lastTransportSentRef.current;
        if (last && last.command === command && now - last.at < TRANSPORT_DEBOUNCE_MS) {
          return null;
        }
        lastTransportSentRef.current = { command, at: now };
      }
      let dedupeKey: string | undefined;
      if (command === "PLAY_SOURCE" && payload?.source) {
        dedupeKey = playSourceDedupeKey(
          payload.source.id,
          payload.source.playlistId,
          typeof payload.trackIndex === "number" ? payload.trackIndex : 0,
        );
        if (playSourcePendingKeyRef.current === dedupeKey) {
          return null;
        }
        playSourcePendingKeyRef.current = dedupeKey;
        setPlaySourceRemotePending(true);
        setRemoteCommandMessage("Loading on streamer…");
      }
      const commandId = nextCommandId();
      const sentId = sendCommand(masterDeviceId, command, payload, commandId);
      if (!sentId) {
        if (dedupeKey && playSourcePendingKeyRef.current === dedupeKey) {
          playSourcePendingKeyRef.current = null;
          setPlaySourceRemotePending(false);
        }
        setRemoteCommandMessage("Branch socket not connected");
        return null;
      }
      const tracked: TrackedRemoteCommand = {
        commandId: sentId,
        command,
        sentAt: now,
        outcome: "pending",
        masterDeviceId,
        dedupeKey,
      };
      trackedCommandsRef.current.set(sentId, tracked);
      setPendingRemoteCommands((prev) => new Set(prev).add(command));
      return sentId;
    },
    [useLocalDeviceTransport, masterDeviceId, sendCommand],
  );

  const playSourceOrSend = useCallback(
    (source: UnifiedSource, trackIndex = 0) => {
      if (useLocalDeviceTransport) {
        playSource(source, trackIndex);
      } else {
        sendCommandToMaster("PLAY_SOURCE", {
          source: unifiedSourceToPayload(source),
          trackIndex,
        });
      }
    },
    [useLocalDeviceTransport, playSource, sendCommandToMaster]
  );

  const queueNextOrSend = useCallback(
    (source: UnifiedSource) => {
      const cloned = createPlayNextFromUnifiedSource(source);
      if (!cloned) return;
      if (useLocalDeviceTransport) {
        addPlayNextSources([cloned]);
      } else {
        sendCommandToMaster("QUEUE_NEXT", { source: unifiedSourceToPayload(cloned) });
      }
    },
    [useLocalDeviceTransport, addPlayNextSources, sendCommandToMaster]
  );

  const queueNextFromPathsOrSend = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      if (useLocalDeviceTransport) {
        addPlayNextFromPaths(paths);
      } else {
        for (const p of paths) {
          sendCommandToMaster("QUEUE_NEXT", { url: p });
        }
      }
    },
    [useLocalDeviceTransport, addPlayNextFromPaths, sendCommandToMaster]
  );

  const queueNextFromUrlsOrSend = useCallback(
    (urls: string[]) => {
      if (urls.length === 0) return;
      if (useLocalDeviceTransport) {
        addPlayNextFromUrls(urls);
      } else {
        for (const u of urls) {
          sendCommandToMaster("QUEUE_NEXT", { url: u });
        }
      }
    },
    [useLocalDeviceTransport, addPlayNextFromUrls, sendCommandToMaster]
  );

  const playOrSend = useCallback(() => {
    if (useLocalDeviceTransport) play();
    else sendCommandToMaster("PLAY");
  }, [useLocalDeviceTransport, play, sendCommandToMaster]);

  const pauseOrSend = useCallback(() => {
    if (useLocalDeviceTransport) pause();
    else sendCommandToMaster("PAUSE");
  }, [useLocalDeviceTransport, pause, sendCommandToMaster]);

  const stopOrSend = useCallback(() => {
    if (useLocalDeviceTransport) stop();
    else sendCommandToMaster("STOP");
  }, [useLocalDeviceTransport, stop, sendCommandToMaster]);

  const nextOrSend = useCallback(() => {
    if (useLocalDeviceTransport) next();
    else sendCommandToMaster("NEXT");
  }, [useLocalDeviceTransport, next, sendCommandToMaster]);

  const prevOrSend = useCallback(() => {
    if (useLocalDeviceTransport) prev();
    else sendCommandToMaster("PREV");
  }, [useLocalDeviceTransport, prev, sendCommandToMaster]);

  const seekOrSend = useCallback(
    (seconds: number) => {
      if (useLocalDeviceTransport) seekTo(seconds);
      else sendCommandToMaster("SEEK", { position: seconds });
    },
    [useLocalDeviceTransport, seekTo, sendCommandToMaster]
  );

  const setVolumeOrSend = useCallback(
    (value: number) => {
      if (useLocalDeviceTransport) setVolume(value);
      else sendCommandToMaster("SET_VOLUME", { volume: value });
    },
    [useLocalDeviceTransport, setVolume, sendCommandToMaster]
  );

  const setShuffleOrSend = useCallback(
    (value: boolean) => {
      if (useLocalDeviceTransport) setShuffle(value);
      else sendCommandToMaster("SET_SHUFFLE", { value });
    },
    [useLocalDeviceTransport, setShuffle, sendCommandToMaster]
  );

  const setAutoMixOrSend = useCallback(
    (value: boolean) => {
      if (useLocalDeviceTransport) setAutoMix(value);
      else sendCommandToMaster("SET_AUTOMIX", { value });
    },
    [useLocalDeviceTransport, sendCommandToMaster]
  );

  const value = useMemo<DevicePlayerContextValue>(
    () => ({
      isActive,
      isBranchConnected,
      deviceId,
      status,
      deviceMode: effectiveDeviceMode,
      masterDeviceId,
      hasExistingMaster: hasExistingMaster ?? false,
      masterState,
      masterConfirmOpen,
      setMasterConfirmOpen,
      reportPosition,
      sendSetMaster,
      sendSetControl,
      sendCommandToMaster,
      playSourceOrSend,
      queueNextOrSend,
      queueNextFromPathsOrSend,
      queueNextFromUrlsOrSend,
      playOrSend,
      pauseOrSend,
      stopOrSend,
      nextOrSend,
      prevOrSend,
      seekOrSend,
      setVolumeOrSend,
      setShuffleOrSend,
      setAutoMixOrSend,
      sessionCode,
      guestLink,
      isObserverOnlyBrowser,
      isMobileLocalPlayback,
      isStreamerDevice,
      remoteCommandMessage,
      isPlaySourceRemotePending: playSourceRemotePending,
      isRemoteCommandPending: (command: RemoteCommand) => pendingRemoteCommands.has(command),
    }),
    [
      isActive,
      isBranchConnected,
      deviceId,
      status,
      effectiveDeviceMode,
      masterDeviceId,
      hasExistingMaster,
      masterState,
      masterConfirmOpen,
      reportPosition,
      sendSetMaster,
      sendSetControl,
      sendCommandToMaster,
      playSourceOrSend,
      queueNextOrSend,
      queueNextFromPathsOrSend,
      queueNextFromUrlsOrSend,
      playOrSend,
      pauseOrSend,
      stopOrSend,
      nextOrSend,
      prevOrSend,
      seekOrSend,
      setVolumeOrSend,
      setShuffleOrSend,
      setAutoMixOrSend,
      sessionCode,
      guestLink,
      isObserverOnlyBrowser,
      isMobileLocalPlayback,
      isStreamerDevice,
      remoteCommandMessage,
      playSourceRemotePending,
      pendingRemoteCommands,
      queueNextOrSend,
      queueNextFromPathsOrSend,
      queueNextFromUrlsOrSend,
    ]
  );

  return (
    <DevicePlayerContext.Provider value={value}>
      {children}
      <SecondaryDesktopModal isOpen={secondaryDesktopModalOpen} onClose={() => setSecondaryDesktopModalOpen(false)} />
      <GuestRecommendationModal
        recommendation={pendingGuestRecommendation}
        onClose={() => setPendingGuestRecommendation(null)}
        onApprove={(id) => {
          sendApproveGuestRecommend(id);
          setPendingGuestRecommendation(null);
        }}
        onReject={(id) => {
          sendRejectGuestRecommend(id);
          setPendingGuestRecommendation(null);
        }}
      />
    </DevicePlayerContext.Provider>
  );
}
