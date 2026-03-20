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

type DevicePlayerContextValue = {
  /** Whether we're on a playback route and provider is active (device role visible). */
  isActive: boolean;
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
  const [secondaryDesktopModalOpen, setSecondaryDesktopModalOpen] = useState(false);
  const [pendingGuestRecommendation, setPendingGuestRecommendation] = useState<GuestRecommendationPayload | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: { email?: string | null }) => setUserId(data?.email ?? ""))
      .catch(() => setUserId(""));
  }, []);
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

  const effectiveUserId = userId ?? "";
  const onDeviceMode = useCallback((mode: DeviceMode) => {
    if (mode === "MASTER") setMasterState(null);
    if (mode === "CONTROL") stop();
  }, [stop]);
  const onStateUpdate = useCallback((state: StationPlaybackState) => setMasterState(state), []);
  const onSecondaryDesktop = useCallback(() => setSecondaryDesktopModalOpen(true), []);
  const onGuestRecommendation = useCallback((rec: GuestRecommendationPayload) => setPendingGuestRecommendation(rec), []);

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
      userId: effectiveUserId,
      onSecondaryDesktop,
      onGuestRecommendation,
    }
  );

  const guestLink =
    typeof window !== "undefined" && sessionCode
      ? `${window.location.origin}/guest?code=${sessionCode}`
      : null;

  // Use server truth when connected. When disconnected, act as MASTER for standalone local playback.
  const effectiveDeviceMode = status === "connected" ? deviceMode : "MASTER";

  useEffect(() => {
    if (isActive) initDeviceId();
  }, [isActive]);

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
