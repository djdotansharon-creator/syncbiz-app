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
import { payloadToUnifiedSource } from "@/lib/remote-control/payload-to-source";
import { unifiedSourceToPayload } from "@/lib/remote-control/source-to-payload";
import { fetchUnifiedSourcesWithFallback } from "@/lib/unified-sources-client";
import { playbackToStationState } from "@/lib/remote-control/playback-to-state";
import type { RemoteCommand, PlaySourcePayload, StationPlaybackState, DeviceMode, GuestRecommendationPayload } from "@/lib/remote-control/types";
import type { UnifiedSource } from "@/lib/source-types";
import { deviceModeAllowsLocalPlayback } from "@/lib/device-mode-guard";
import { getAutoMix, setAutoMix, onAutoMixChanged } from "@/lib/mix-preferences";

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
  /** Send command to master (when in CONTROL mode). */
  sendCommandToMaster: (command: RemoteCommand, payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number; value?: boolean; trackIndex?: number }) => void;
  /** Play source locally (MASTER) or send to master (CONTROL). */
  playSourceOrSend: (source: UnifiedSource, trackIndex?: number) => void;
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
const ELIGIBLE_BROWSER_PLAYER_ROUTES = ["/player", "/remote-player", "/sources", "/mobile"] as const;

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
  const [wsToken, setWsToken] = useState<string | null>(null);
  const [tokenRefreshTrigger, setTokenRefreshTrigger] = useState(0);
  const [secondaryDesktopModalOpen, setSecondaryDesktopModalOpen] = useState(false);
  const [pendingGuestRecommendation, setPendingGuestRecommendation] = useState<GuestRecommendationPayload | null>(null);

  /** Dev-only: dedupe console noise — log when branch/guest diagnostic snapshot changes. */
  const branchDiagSnapshotRef = useRef<string>("");

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!isActive || !authLoaded || !(userId ?? "").trim()) {
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
  }, [isActive, authLoaded, userId, tokenRefreshTrigger]);

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
    currentTrackIndex,
    queue,
    queueIndex,
    volume,
  } = usePlayback();
  const [masterConfirmOpen, setMasterConfirmOpen] = useState(false);
  const [masterState, setMasterState] = useState<StationPlaybackState | null>(null);
  const [autoMixState, setAutoMixState] = useState<boolean>(() => getAutoMix());
  const lastConnectedModeRef = useRef<DeviceMode | null>(null);
  const prevEffectiveModeRef = useRef<DeviceMode>("MASTER");
  const pendingMasterAdoptionRef = useRef(false);
  const reportedPositionRef = useRef<{ position: number; duration: number } | null>(null);

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
      command: string;
      payload?: { url?: string; source?: unknown; position?: number; volume?: number; value?: boolean; trackIndex?: number };
    }) => {
      const command = cmd.command as RemoteCommand;
      if (command === "PLAY") play();
      else if (command === "PAUSE") pause();
      else if (command === "STOP") stop();
      else if (command === "NEXT") {
        console.log("[SyncBiz Audit] NEXT path resolved", {
          context: "remote_command",
          deviceMode,
          currentSourceId: currentSource?.id,
          currentTrackIndex,
          queueIndex,
          queueLength: queue.length,
        });
        next();
        console.log("[SyncBiz Audit] state after manual next", {
          context: "remote_command",
          deviceMode,
          currentSourceId: currentSource?.id,
          currentTrackIndex,
          queueIndex,
          queueLength: queue.length,
        });
      } else if (command === "PREV") {
        console.log("[SyncBiz Audit] PREV path resolved", {
          context: "remote_command",
          deviceMode,
          currentSourceId: currentSource?.id,
          currentTrackIndex,
          queueIndex,
          queueLength: queue.length,
        });
        prev();
        console.log("[SyncBiz Audit] state after manual prev", {
          context: "remote_command",
          deviceMode,
          currentSourceId: currentSource?.id,
          currentTrackIndex,
          queueIndex,
          queueLength: queue.length,
        });
      }
      else if (command === "SET_SHUFFLE" && typeof cmd.payload?.value === "boolean") setShuffle(cmd.payload.value);
      else if (command === "SET_AUTOMIX" && typeof cmd.payload?.value === "boolean") setAutoMix(cmd.payload.value);
      else if (command === "SEEK" && typeof cmd.payload?.position === "number") {
        seekTo(cmd.payload.position);
      } else if (command === "SET_VOLUME" && typeof cmd.payload?.volume === "number") {
        setVolume(Math.max(0, Math.min(100, cmd.payload.volume)));
      } else if (command === "LOAD_PLAYLIST" && cmd.payload?.url) {
        playSource(urlToUnifiedSource(cmd.payload.url));
      } else if (command === "PLAY_SOURCE" && cmd.payload?.source) {
        const payload = cmd.payload.source as PlaySourcePayload;
        const trackIdx = typeof cmd.payload.trackIndex === "number" ? cmd.payload.trackIndex : 0;
        fetchUnifiedSourcesWithFallback()
          .then((items) => {
            const full = items.find((s) => s.id === payload.id);
            if (full) playSource(full, trackIdx);
            else playSource(payloadToUnifiedSource(payload), trackIdx);
          })
          .catch(() => playSource(payloadToUnifiedSource(payload), trackIdx));
      }
    },
    [play, pause, stop, next, prev, playSource, seekTo, setVolume, setShuffle, setAutoMix]
  );

  const effectiveUserId = (userId ?? "").trim();
  const onDeviceMode = useCallback((mode: DeviceMode) => {
    console.log("[SyncBiz Audit] Device mode change", {
      mode,
    });
    if (mode === "CONTROL") {
      console.log("[SyncBiz Audit] CONTROL transition -> stopForControlHandoff (no stop-local)");
      stopForControlHandoff();
    }
  }, [stopForControlHandoff]);
  const onStateUpdate = useCallback((state: StationPlaybackState) => setMasterState(state), []);
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
    setTokenRefreshTrigger((k) => k + 1);
  }, []);

  const {
    status,
    deviceMode,
    sendSetMaster,
    sendSetControl,
    sendState,
    sendCommand,
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
      isDesktopApp: isElectronShell === true,
    }
  );

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
  // Plain browser: only real player surfaces may own local branch output; `/settings` stays non-executing.
  deviceModeAllowsLocalPlayback.current =
    (!isActive || effectiveDeviceMode === "MASTER") &&
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
    isBranchConnected,
    currentSource?.id,
    masterState?.currentSource?.id,
    masterState?.currentTrackIndex,
    masterState?.status,
    playSource,
    pause,
  ]);

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
      volume
    );
    sendState(state);
  }, [isActive, status, deviceMode, sendState, playStatus, currentSource?.id, currentTrackIndex, queue, queueIndex, volume, shuffle, autoMixState]);

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
        volume
      );
      sendState(state);
    }, 1000);
    return () => clearInterval(id);
  }, [isActive, status, deviceMode, playStatus, sendState, currentSource?.id, currentTrackIndex, queue, queueIndex, volume, shuffle, autoMixState]);

  const sendCommandToMaster = useCallback(
    (command: RemoteCommand, payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number; value?: boolean; trackIndex?: number }) => {
      if (!masterDeviceId) return;
      sendCommand(masterDeviceId, command, payload);
    },
    [masterDeviceId, sendCommand]
  );

  const playSourceOrSend = useCallback(
    (source: UnifiedSource, trackIndex = 0) => {
      if (effectiveDeviceMode === "MASTER") {
        playSource(source, trackIndex);
      } else {
        sendCommandToMaster("PLAY_SOURCE", {
          source: unifiedSourceToPayload(source),
          trackIndex,
        });
      }
    },
    [effectiveDeviceMode, playSource, sendCommandToMaster]
  );

  const playOrSend = useCallback(() => {
    if (effectiveDeviceMode === "MASTER") play();
    else sendCommandToMaster("PLAY");
  }, [effectiveDeviceMode, play, sendCommandToMaster]);

  const pauseOrSend = useCallback(() => {
    if (effectiveDeviceMode === "MASTER") pause();
    else sendCommandToMaster("PAUSE");
  }, [effectiveDeviceMode, pause, sendCommandToMaster]);

  const stopOrSend = useCallback(() => {
    if (effectiveDeviceMode === "MASTER") stop();
    else sendCommandToMaster("STOP");
  }, [effectiveDeviceMode, stop, sendCommandToMaster]);

  const nextOrSend = useCallback(() => {
    if (effectiveDeviceMode === "MASTER") next();
    else sendCommandToMaster("NEXT");
  }, [effectiveDeviceMode, next, sendCommandToMaster]);

  const prevOrSend = useCallback(() => {
    if (effectiveDeviceMode === "MASTER") prev();
    else sendCommandToMaster("PREV");
  }, [effectiveDeviceMode, prev, sendCommandToMaster]);

  const seekOrSend = useCallback(
    (seconds: number) => {
      if (effectiveDeviceMode === "MASTER") seekTo(seconds);
      else sendCommandToMaster("SEEK", { position: seconds });
    },
    [effectiveDeviceMode, seekTo, sendCommandToMaster]
  );

  const setVolumeOrSend = useCallback(
    (value: number) => {
      if (effectiveDeviceMode === "MASTER") setVolume(value);
      else sendCommandToMaster("SET_VOLUME", { volume: value });
    },
    [effectiveDeviceMode, setVolume, sendCommandToMaster]
  );

  const setShuffleOrSend = useCallback(
    (value: boolean) => {
      if (effectiveDeviceMode === "MASTER") setShuffle(value);
      else sendCommandToMaster("SET_SHUFFLE", { value });
    },
    [effectiveDeviceMode, setShuffle, sendCommandToMaster]
  );

  const setAutoMixOrSend = useCallback(
    (value: boolean) => {
      if (effectiveDeviceMode === "MASTER") setAutoMix(value);
      else sendCommandToMaster("SET_AUTOMIX", { value });
    },
    [effectiveDeviceMode, sendCommandToMaster]
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
