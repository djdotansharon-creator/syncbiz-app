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
import { useMobileRole } from "@/lib/mobile-role-context";
import { isStreamerDeviceMode } from "@/lib/streamer-device-mode";

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
  /**
   * `/mobile/...` + role "player": this tab should play through the in-app engine on the phone even
   * if the branch device is CONTROL (station MASTER elsewhere). Not the same as `deviceMode === "MASTER"`.
   */
  isMobileLocalPlayback: boolean;
  /** GOtv / Android TV dedicated branch player (`/streamer`). */
  isStreamerDevice: boolean;
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
 * Browser: operator pages that must NEVER own local branch audio even as MASTER
 * (`/settings`, `/library`) — the exclusion used by the MASTER exception below.
 */
function isBrowserNonExecutingRoute(pathname: string): boolean {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return true;
  if (pathname === "/library" || pathname.startsWith("/library/")) return true;
  return false;
}

/**
 * Browser: operator pages that need a branch `device` socket (MASTER/CONTROL in Settings, MY LINK in
 * Sources rail, etc.) but must not own local branch audio — gated separately via `isEligibleBrowserPlayerRoute`.
 *
 * `/schedules` and `/radio` are included so the SAME tab keeps its device socket (and MASTER
 * lease) while the operator moves between top-nav tabs. Before this, switching to Schedules/Radio
 * closed the socket, dropped the lease into its 90s grace window, and made the header MASTER/
 * STANDALONE chips vanish — the header must stay stable across tabs. Local audio for a MASTER
 * browser on these routes stays allowed via the MASTER exception (see `isBrowserNonExecutingRoute`).
 */
function isBrowserBranchControlsOnlyRoute(pathname: string): boolean {
  if (isBrowserNonExecutingRoute(pathname)) return true;
  if (pathname === "/sources" || pathname.startsWith("/sources/")) return true;
  if (pathname === "/schedules" || pathname.startsWith("/schedules/")) return true;
  if (pathname === "/radio" || pathname.startsWith("/radio/")) return true;
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
    currentPlaylist,
    currentTrackIndex,
    queue,
    queueIndex,
    volume,
    playNextQueue,
    playNextBaseline,
    isRestoring,
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
        // Play immediately from the payload for zero-latency start.
        // The payload carries id/url/title/type — sufficient to begin playback and
        // emit an immediate loading/playing STATE_UPDATE to the CONTROL.
        // Removed the blocking fetchUnifiedSourcesWithFallback() call that caused
        // 15+ second delays on Railway before the first track could start.
        playSource(payloadToUnifiedSource(payload), trackIdx);
      }
    },
    [play, pause, stop, next, prev, playSource, seekTo, setVolume, setShuffle, setAutoMix]
  );

  const effectiveUserId = (userId ?? "").trim();

  /* ── Playing-player protection (client mirror of the server's MASTER_LOCKED_PLAYING) ──
     A tab that is actively PLAYING must never be silently wiped by a CONTROL flip.
     The eject bug this fixes: the operator presses Play while the WS is still
     registering (Railway auth can take 10+s); playback starts under the provisional
     MASTER default; registration then answers with an initial CONTROL, which used to
     stopForControlHandoff() — wiping player + queue — moments before MASTER arrived.
     Instead, a playing tab re-claims MASTER once. The server grants it unless another
     MASTER is genuinely playing (MASTER_LOCKED_PLAYING) or a priority device holds it —
     those denials stop local audio via onMasterClaimDenied (one branch = one audio). */
  const playStatusRef = useRef(playStatus);
  useEffect(() => {
    playStatusRef.current = playStatus;
  }, [playStatus]);
  const sendSetMasterRef = useRef<(() => void) | null>(null);
  /* State (not just a ref) so `effectiveDeviceMode` re-renders as MASTER for the
     whole reclaim window — the audio engine must never see the transient CONTROL
     (a single CONTROL render unmounts the embedded players and playback dies
     even though the session survives). */
  const [masterReclaimInFlight, setMasterReclaimInFlight] = useState(false);
  const masterReclaimInFlightRef = useRef(false);
  const setMasterReclaim = useCallback((v: boolean) => {
    masterReclaimInFlightRef.current = v;
    setMasterReclaimInFlight(v);
  }, []);

  const onDeviceMode = useCallback(
    (mode: DeviceMode) => {
      console.log("[SyncBiz Audit] Device mode change", {
        mode,
      });
      if (mode === "MASTER") {
        setMasterReclaim(false);
        return;
      }
      if (mode === "CONTROL" && !isMobileLocalPlayback) {
        if (playStatusRef.current === "playing" && !masterReclaimInFlightRef.current) {
          setMasterReclaim(true);
          console.warn(
            "[SyncBiz Audit] CONTROL while locally PLAYING — re-claiming MASTER instead of wiping (playing-player protection)",
          );
          sendSetMasterRef.current?.();
          return;
        }
        setMasterReclaim(false);
        console.log("[SyncBiz Audit] CONTROL transition -> stopForControlHandoff (no stop-local)");
        stopForControlHandoff();
      }
    },
    [stopForControlHandoff, isMobileLocalPlayback, setMasterReclaim],
  );

  const onMasterClaimDenied = useCallback(
    (reason: string) => {
      const wasReclaiming = masterReclaimInFlightRef.current;
      setMasterReclaim(false);
      if (wasReclaiming && playStatusRef.current === "playing" && !isMobileLocalPlayback) {
        console.warn(
          `[SyncBiz Audit] MASTER re-claim denied (${reason}) — stopping local playback (another device owns branch audio)`,
        );
        stopForControlHandoff();
      }
    },
    [stopForControlHandoff, isMobileLocalPlayback, setMasterReclaim],
  );

  /* Reclaim never resolved (message lost / server silent): fail safe after 10s —
     drop the MASTER override; if still CONTROL and playing, stop to avoid double audio. */
  useEffect(() => {
    if (!masterReclaimInFlight) return;
    const t = setTimeout(() => {
      if (!masterReclaimInFlightRef.current) return;
      setMasterReclaim(false);
      if (playStatusRef.current === "playing") {
        console.warn("[SyncBiz Audit] MASTER re-claim timed out — stopping local playback");
        stopForControlHandoff();
      }
    }, 10_000);
    return () => clearTimeout(t);
  }, [masterReclaimInFlight, setMasterReclaim, stopForControlHandoff]);
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
    modeAssigned,
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
      onMasterClaimDenied,
      isDesktopApp: isElectronShell === true,
      isStreamerDevice,
    }
  );

  // onDeviceMode is created before the WS hook returns sendSetMaster — bridge via ref.
  useEffect(() => {
    sendSetMasterRef.current = sendSetMaster;
  }, [sendSetMaster]);

  const guestLink =
    typeof window !== "undefined" && sessionCode
      ? `${window.location.origin}/guest?code=${sessionCode}`
      : null;

  // Use server truth when connected. During reconnect blips, keep last connected mode to avoid
  // CONTROL<->standalone oscillation during live handoff.
  //
  // Two guarded windows keep a PLAYING tab's engine alive (playing-player protection):
  // 1. `!modeAssigned` — connected but the server hasn't sent SET_DEVICE_MODE yet; `deviceMode`
  //    is still the useState default ("CONTROL"), not a decision. Acting on it unmounted the
  //    embedded players mid-song when playback began before registration finished.
  // 2. Reclaim in flight — server said CONTROL while we were playing; we answered SET_MASTER.
  //    Hold MASTER until the server grants (SET_DEVICE_MODE MASTER), denies (onMasterClaimDenied
  //    stops playback), or the 10s timeout fires. The engine never sees the transient CONTROL.
  const effectiveDeviceMode =
    status === "connected"
      ? !modeAssigned || (deviceMode === "CONTROL" && masterReclaimInFlight)
        ? (lastConnectedModeRef.current ?? "MASTER")
        : deviceMode
      : (lastConnectedModeRef.current ?? "MASTER");

  const isBranchConnected = isActive && authLoaded && !!effectiveUserId && status === "connected";

  // ─── Diagnostic: log whenever role/connectivity changes ─────────────────
  const _diagCtxRef = useRef({ status: "init", deviceMode: "init", isBranchConnected: false, isActive: false, pathname: "init" });
  useEffect(() => {
    const prev = _diagCtxRef.current;
    const curr = { status, deviceMode, effectiveDeviceMode, isBranchConnected, isActive, pathname };
    if (prev.status !== status || prev.deviceMode !== deviceMode || prev.isBranchConnected !== isBranchConnected || prev.isActive !== isActive || prev.pathname !== pathname) {
      console.warn("[SyncBiz DIAG] DeviceCtx change", { prev: { status: prev.status, deviceMode: prev.deviceMode, isBranchConnected: prev.isBranchConnected, isActive: prev.isActive }, curr: { status, deviceMode, effectiveDeviceMode, isBranchConnected, isActive, pathname }, ts: new Date().toISOString() });
      _diagCtxRef.current = { status, deviceMode, isBranchConnected, isActive, pathname };
    }
  });
  // ────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Only record REAL server decisions: skip the pre-SET_DEVICE_MODE default and the
    // reclaim window (recording their transient CONTROL would defeat the MASTER hold
    // in `effectiveDeviceMode` above).
    if (status === "connected" && modeAssigned && !(deviceMode === "CONTROL" && masterReclaimInFlight)) {
      lastConnectedModeRef.current = deviceMode;
    }
  }, [status, deviceMode, modeAssigned, masterReclaimInFlight]);

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
  //
  // MASTER exception (added): A MASTER-role browser device can start local playback from any
  // workspace route (e.g. /radio, /schedules), not only the dedicated player surfaces. Without
  // this, solo users navigating to /radio or /schedules would find all playSource/play/next calls
  // silently blocked even though they are the sole MASTER device. CONTROL devices are still
  // blocked on all routes regardless of this change.
  //
  // The MASTER exception explicitly does NOT cover non-executing routes (`/settings`,
  // `/library`): those open a device socket but must stay non-executing (see docstrings above).
  // `/sources` remains allowed via the eligible-route list; `/schedules` and `/radio` are
  // controls-only for the SOCKET but a MASTER browser may keep playing on them (tab switches
  // while music is running must never gate playback).
  deviceModeAllowsLocalPlayback.current =
    (isMobileLocalPlayback || !isActive || effectiveDeviceMode === "MASTER") &&
    (!isBrowserShell ||
      isEligibleBrowserPlayerRoute(pathname) ||
      (effectiveDeviceMode === "MASTER" && !isBrowserNonExecutingRoute(pathname)));

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

  const sessionMirrorInput = useMemo(
    () => ({
      currentPlaylist,
      playNextQueue,
      playNextBaseline,
    }),
    [currentPlaylist, playNextQueue, playNextBaseline],
  );

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
      sessionMirrorInput,
    );
    sendState(state);
  }, [isActive, status, deviceMode, sendState, playStatus, currentSource?.id, currentTrackIndex, queue, queueIndex, volume, shuffle, autoMixState, sessionMirrorInput]);

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
        sessionMirrorInput,
      );
      sendState(state);
    }, 1000);
    return () => clearInterval(id);
  }, [isActive, status, deviceMode, playStatus, sendState, currentSource?.id, currentTrackIndex, queue, queueIndex, volume, shuffle, autoMixState, sessionMirrorInput]);

  const sendCommandToMaster = useCallback(
    (command: RemoteCommand, payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number; value?: boolean; trackIndex?: number }) => {
      if (!masterDeviceId) return;
      sendCommand(masterDeviceId, command, payload);
    },
    [masterDeviceId, sendCommand]
  );

  const useLocalDeviceTransport = effectiveDeviceMode === "MASTER" || isMobileLocalPlayback;

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
      isMobileLocalPlayback,
      isStreamerDevice,
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
