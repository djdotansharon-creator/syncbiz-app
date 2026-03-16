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
import type { StationPlaybackState, DeviceInfo } from "@/lib/remote-control/types";
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
  sendSeek: (seconds: number) => void;
  sendSetVolume: (volume: number) => void;
};

const StationControllerContext = createContext<StationControllerContextValue | null>(null);

export function StationControllerProvider({ children }: { children: ReactNode }) {
  const { devices, masterDeviceId, status, sendCommand, remoteState: allRemoteState } = useRemoteController();

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
      sendSeek,
      sendSetVolume,
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
      sendSeek,
      sendSetVolume,
    ]
  );

  return (
    <StationControllerContext.Provider value={value}>
      {children}
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
    sendSeek: () => {},
    sendSetVolume: () => {},
  };
}
