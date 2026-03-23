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

type DevicePlayerContextValue = {
  /** Whether we're on a playback route and provider is active (device role visible). */
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
  sendCommandToMaster: (command: RemoteCommand, payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number }) => void;
  /** Play source locally (MASTER) or send to master (CONTROL). */
  playSourceOrSend: (source: UnifiedSource) => void;
  /** Play/pause/stop/next/prev - local when MASTER, send to master when CONTROL. */
  playOrSend: () => void;
  pauseOrSend: () => void;
  stopOrSend: () => void;
  nextOrSend: () => void;
  prevOrSend: () => void;
  seekOrSend: (seconds: number) => void;
  setVolumeOrSend: (value: number) => void;
  /** Session code for guest recommendations. Operator shares /guest?code=XXX */
  sessionCode: string | null;
  /** Full guest recommendation link for sharing */
  guestLink: string | null;
};

const DevicePlayerContext = createContext<DevicePlayerContextValue | null>(null);

/** Routes where device registers and shows MASTER/CONTROL – playback + device role visibility. */
const PLAYBACK_ROUTES = ["/remote-player", "/sources", "/radio", "/library", "/favorites", "/playlists", "/player"] as const;

function isPlaybackRoute(pathname: string): boolean {
  if (pathname === "/mobile") return false;
  return PLAYBACK_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** E: Device role visible across full top nav. Active on all desktop routes except /mobile. */
/** On /mobile, never active – mobile is either controller (sends commands) or standalone local player (no device role). */
function isDeviceRoleActive(pathname: string): boolean {
  return pathname !== "/mobile";
}

export function useDevicePlayer() {
  const ctx = useContext(DevicePlayerContext);
  return ctx;
}

export function DevicePlayerProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isActive = isDeviceRoleActive(pathname);
  const deviceId = isActive ? getDeviceId() : null;

  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [wsToken, setWsToken] = useState<string | null>(null);
  const [tokenRefreshTrigger, setTokenRefreshTrigger] = useState(0);
  const [secondaryDesktopModalOpen, setSecondaryDesktopModalOpen] = useState(false);
  const [pendingGuestRecommendation, setPendingGuestRecommendation] = useState<GuestRecommendationPayload | null>(null);

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

  /** Proactive token refresh: fetch new token before expiry. Does NOT trigger reconnect. */
  const PROACTIVE_REFRESH_INTERVAL_MS = 45_000;

  useEffect(() => {
    if (!isActive || !wsToken || !authLoaded) return;
    if (process.env.NODE_ENV === "development") {
      const refreshAt = new Date(Date.now() + PROACTIVE_REFRESH_INTERVAL_MS).toISOString();
      console.info("[SyncBiz WS client] proactive token refresh scheduled", { role: "device", refreshAt });
    }
    const id = setInterval(() => {
      fetch("/api/auth/ws-token")
        .then((r) => r.ok ? r.json() : null)
        .then((data: { token?: string } | null) => {
          if (data?.token) {
            setWsToken(data.token);
            if (process.env.NODE_ENV === "development") {
              console.info("[SyncBiz WS client] token refreshed (no reconnect)", { role: "device" });
            }
          }
        })
        .catch(() => {});
    }, PROACTIVE_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isActive, authLoaded, wsToken]);

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
  const { play, pause, stop, next, prev, playSource, setVolume, seekTo, status: playStatus, currentSource, currentTrackIndex, queue, queueIndex, volume } = usePlayback();
  const [masterConfirmOpen, setMasterConfirmOpen] = useState(false);
  const [masterState, setMasterState] = useState<StationPlaybackState | null>(null);
  const reportedPositionRef = useRef<{ position: number; duration: number } | null>(null);

  const reportPosition = useCallback((position: number, duration: number) => {
    if (Number.isFinite(position) && Number.isFinite(duration)) {
      reportedPositionRef.current = { position, duration };
    }
  }, []);

  const onCommand = useCallback(
    (cmd: { command: string; payload?: { url?: string; source?: unknown; position?: number; volume?: number } }) => {
      const command = cmd.command as RemoteCommand;
      if (command === "PLAY") play();
      else if (command === "PAUSE") pause();
      else if (command === "STOP") stop();
      else if (command === "NEXT") next();
      else if (command === "PREV") prev();
      else if (command === "SEEK" && typeof cmd.payload?.position === "number") {
        seekTo(cmd.payload.position);
      } else if (command === "SET_VOLUME" && typeof cmd.payload?.volume === "number") {
        setVolume(Math.max(0, Math.min(100, cmd.payload.volume)));
      } else if (command === "LOAD_PLAYLIST" && cmd.payload?.url) {
        playSource(urlToUnifiedSource(cmd.payload.url));
      } else if (command === "PLAY_SOURCE" && cmd.payload?.source) {
        const payload = cmd.payload.source as PlaySourcePayload;
        fetchUnifiedSourcesWithFallback()
          .then((items) => {
            const full = items.find((s) => s.id === payload.id);
            if (full) playSource(full);
            else playSource(payloadToUnifiedSource(payload));
          })
          .catch(() => playSource(payloadToUnifiedSource(payload)));
      }
    },
    [play, pause, stop, next, prev, playSource, seekTo, setVolume]
  );

  const effectiveUserId = (userId ?? "").trim();
  const onDeviceMode = useCallback((mode: DeviceMode) => {
    if (mode === "MASTER") setMasterState(null);
    if (mode === "CONTROL") stop();
  }, [stop]);
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
    }
  );

  const guestLink =
    typeof window !== "undefined" && sessionCode
      ? `${window.location.origin}/guest?code=${sessionCode}`
      : null;

  // Use server truth when connected. When disconnected, act as MASTER for standalone local playback.
  const effectiveDeviceMode = status === "connected" ? deviceMode : "MASTER";

  const isBranchConnected = isActive && authLoaded && !!effectiveUserId && status === "connected";

  useEffect(() => {
    if (isActive) initDeviceId();
    return () => {
      deviceModeAllowsLocalPlayback.current = true;
    };
  }, [isActive]);

  // Block local playback when on device route until we know we're MASTER (prevents CONTROL from restoring).
  // Allow when: not on device route; or disconnected (standalone); or connected and MASTER.
  deviceModeAllowsLocalPlayback.current = !isActive || status === "disconnected" || (status === "connected" && deviceMode === "MASTER");

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
      pd ? { position: pd.position, duration: pd.duration } : undefined,
      volume
    );
    sendState(state);
  }, [isActive, status, deviceMode, sendState, playStatus, currentSource?.id, currentTrackIndex, queue, queueIndex, volume]);

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
        pd ? { position: pd.position, duration: pd.duration } : undefined,
        volume
      );
      sendState(state);
    }, 1000);
    return () => clearInterval(id);
  }, [isActive, status, deviceMode, playStatus, sendState, currentSource?.id, currentTrackIndex, queue, queueIndex, volume]);

  const sendCommandToMaster = useCallback(
    (command: RemoteCommand, payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number }) => {
      if (!masterDeviceId) return;
      sendCommand(masterDeviceId, command, payload);
    },
    [masterDeviceId, sendCommand]
  );

  const playSourceOrSend = useCallback(
    (source: UnifiedSource) => {
      if (effectiveDeviceMode === "MASTER") {
        playSource(source);
      } else {
        sendCommandToMaster("PLAY_SOURCE", { source: unifiedSourceToPayload(source) });
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
      sessionCode,
      guestLink,
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
      sessionCode,
      guestLink,
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
