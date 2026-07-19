"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRemoteController } from "@/lib/remote-control/ws-client";
import type { StationPlaybackState, DeviceInfo, GuestRecommendationPayload } from "@/lib/remote-control/types";
import { GuestRecommendationModal } from "@/components/guest-recommendation-modal";
import type { UnifiedSource } from "@/lib/source-types";
import { unifiedSourceToPayload } from "@/lib/remote-control/source-to-payload";

type StationControllerContextValue = {
  /** Whether we have a remote player and are controlling it (cross-device mode). */
  isCrossDevice: boolean;
  /** Selected device ID for commands. */
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
  /** Remote playback state for the selected device. */
  remoteState: StationPlaybackState | null;
  /** WS connection status. */
  status: "connecting" | "connected" | "disconnected" | "error";
  /** Available player devices. */
  devices: DeviceInfo[];
  /** Send command to the selected device. */
  sendPlay: () => void;
  sendPause: () => void;
  sendStop: () => void;
  sendNext: () => void;
  sendPrev: () => void;
  sendPlaySource: (source: UnifiedSource) => void;
  /** Add a song to the MASTER's Play-Next queue (existing QUEUE_NEXT command). */
  sendQueueNext: (source: UnifiedSource) => void;
  sendSeek: (seconds: number) => void;
  sendSetVolume: (volume: number) => void;
  /** Toggle MASTER shuffle. Sends the absolute desired value (existing SET_SHUFFLE command). */
  sendSetShuffle: (value: boolean) => void;
  /** Toggle MASTER AutoMix/crossfade. Sends the absolute desired value (existing SET_AUTOMIX command). */
  sendSetAutoMix: (value: boolean) => void;
};

const StationControllerContext = createContext<StationControllerContextValue | null>(null);

export function StationControllerProvider({ children }: { children: ReactNode }) {
  const [pendingGuestRecommendation, setPendingGuestRecommendation] = useState<GuestRecommendationPayload | null>(null);
  const onGuestRecommendation = useCallback((rec: GuestRecommendationPayload) => setPendingGuestRecommendation(rec), []);

  const {
    devices,
    masterDeviceId,
    status,
    sendCommand,
    remoteState: allRemoteState,
    sendApproveGuestRecommend,
    sendRejectGuestRecommend,
  } = useRemoteController({
    onGuestRecommendation,
  });

  // C: Always target current MASTER. No stale playback target references.
  const remoteState = masterDeviceId ? allRemoteState[masterDeviceId] ?? null : null;
  const isCrossDevice = !!masterDeviceId && status === "connected";

  const sendPlay = useCallback(() => {
    if (masterDeviceId) sendCommand(masterDeviceId, "PLAY");
  }, [masterDeviceId, sendCommand]);

  const sendPause = useCallback(() => {
    if (masterDeviceId) sendCommand(masterDeviceId, "PAUSE");
  }, [masterDeviceId, sendCommand]);

  const sendStop = useCallback(() => {
    if (masterDeviceId) sendCommand(masterDeviceId, "STOP");
  }, [masterDeviceId, sendCommand]);

  const sendNext = useCallback(() => {
    if (masterDeviceId) sendCommand(masterDeviceId, "NEXT");
  }, [masterDeviceId, sendCommand]);

  const sendPrev = useCallback(() => {
    if (masterDeviceId) sendCommand(masterDeviceId, "PREV");
  }, [masterDeviceId, sendCommand]);

  const sendPlaySource = useCallback(
    (source: UnifiedSource) => {
      if (masterDeviceId) {
        sendCommand(masterDeviceId, "PLAY_SOURCE", { source: unifiedSourceToPayload(source) });
      }
    },
    [masterDeviceId, sendCommand]
  );

  // Add to queue on the MASTER — reuses the existing QUEUE_NEXT command (same
  // sendCommand path as PLAY_SOURCE). The MASTER enqueues via addPlayNextSources
  // and echoes the updated playNextQueue back through STATE_UPDATE. No local audio.
  const sendQueueNext = useCallback(
    (source: UnifiedSource) => {
      if (masterDeviceId) {
        sendCommand(masterDeviceId, "QUEUE_NEXT", { source: unifiedSourceToPayload(source) });
      }
    },
    [masterDeviceId, sendCommand]
  );

  const sendSeek = useCallback(
    (seconds: number) => {
      if (masterDeviceId && Number.isFinite(seconds)) {
        sendCommand(masterDeviceId, "SEEK", { position: seconds });
      }
    },
    [masterDeviceId, sendCommand]
  );

  const sendSetVolume = useCallback(
    (volume: number) => {
      if (masterDeviceId && Number.isFinite(volume)) {
        sendCommand(masterDeviceId, "SET_VOLUME", { volume: Math.max(0, Math.min(100, volume)) });
      }
    },
    [masterDeviceId, sendCommand]
  );

  // Random/AutoMix as REAL remote actions (not just mirrored display). These reuse
  // the EXISTING protocol: the SET_SHUFFLE / SET_AUTOMIX RemoteCommands are already
  // routed by the server and executed by the MASTER (device-player-context handles
  // them → setShuffle/setAutoMix), which then broadcasts a fresh STATE_UPDATE back
  // to every CONTROL. We send the ABSOLUTE desired value (not a flip): the button's
  // displayed state comes only from remoteState, so a double-click can never desync
  // into a wrong optimistic state — the last value simply wins.
  const sendSetShuffle = useCallback(
    (value: boolean) => {
      if (masterDeviceId) sendCommand(masterDeviceId, "SET_SHUFFLE", { value });
    },
    [masterDeviceId, sendCommand]
  );

  const sendSetAutoMix = useCallback(
    (value: boolean) => {
      if (masterDeviceId) sendCommand(masterDeviceId, "SET_AUTOMIX", { value });
    },
    [masterDeviceId, sendCommand]
  );

  const value = useMemo(
    () => ({
      isCrossDevice,
      selectedDeviceId: masterDeviceId,
      setSelectedDeviceId: () => {},
      remoteState,
      status,
      devices,
      sendPlay,
      sendPause,
      sendStop,
      sendNext,
      sendPrev,
      sendPlaySource,
      sendQueueNext,
      sendSeek,
      sendSetVolume,
      sendSetShuffle,
      sendSetAutoMix,
    }),
    [
      isCrossDevice,
      masterDeviceId,
      remoteState,
      status,
      devices,
      sendPlay,
      sendPause,
      sendStop,
      sendNext,
      sendPrev,
      sendPlaySource,
      sendQueueNext,
      sendSeek,
      sendSetVolume,
      sendSetShuffle,
      sendSetAutoMix,
    ]
  );

  return (
    <StationControllerContext.Provider value={value}>
      {children}
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
    </StationControllerContext.Provider>
  );
}

export function useStationController() {
  const ctx = useContext(StationControllerContext);
  return ctx ?? {
    isCrossDevice: false,
    selectedDeviceId: null,
    setSelectedDeviceId: () => {},
    remoteState: null,
    status: "disconnected" as const,
    devices: [] as DeviceInfo[],
    sendPlay: () => {},
    sendPause: () => {},
    sendStop: () => {},
    sendNext: () => {},
    sendPrev: () => {},
    sendPlaySource: () => {},
    sendQueueNext: () => {},
    sendSeek: () => {},
    sendSetVolume: () => {},
    sendSetShuffle: () => {},
    sendSetAutoMix: () => {},
  };
}
