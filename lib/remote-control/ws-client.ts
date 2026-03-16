"use client";

/**
 * WebSocket client for remote control.
 * Connects to the WS server and handles registration + command listening.
 */

import { useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, StationPlaybackState, DeviceMode, RemoteCommand } from "./types";

export function getWsUrl(): string {
  if (typeof window === "undefined") return "";
  const base = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";
  return base.replace(/^http/, "ws").replace(/\/$/, "");
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export function useRemoteControlWs(
  role: "device" | "controller",
  deviceId: string | null,
  onCommand?: (cmd: { command: string; payload?: { url?: string; source?: unknown } }) => void,
  onDeviceMode?: (mode: DeviceMode) => void,
  options?: { isMobile?: boolean; onStateUpdate?: (state: StationPlaybackState) => void }
) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("CONTROL");
  const [masterDeviceId, setMasterDeviceId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onCommandRef = useRef(onCommand);
  const onDeviceModeRef = useRef(onDeviceMode);
  const onStateUpdateRef = useRef(options?.onStateUpdate);
  const deviceModeRef = useRef<DeviceMode>("CONTROL");
  onCommandRef.current = onCommand;
  onDeviceModeRef.current = onDeviceMode;
  onStateUpdateRef.current = options?.onStateUpdate;
  deviceModeRef.current = deviceMode;

  useEffect(() => {
    if (role === "device" && !deviceId) return;

    const url = getWsUrl();
    if (!url) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      const msg: ClientMessage =
        role === "device"
          ? { type: "REGISTER", role: "device", deviceId: deviceId ?? undefined, isMobile: options?.isMobile }
          : { type: "REGISTER", role: "controller" };
      ws.send(JSON.stringify(msg));
      setStatus("connected");
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as ServerMessage;
        if (data.type === "SET_DEVICE_MODE") {
          deviceModeRef.current = data.mode;
          setDeviceMode(data.mode);
          if ("masterDeviceId" in data && data.masterDeviceId) setMasterDeviceId(data.masterDeviceId);
          else if (data.mode === "MASTER") setMasterDeviceId(null);
          onDeviceModeRef.current?.(data.mode);
        } else if (data.type === "COMMAND" && onCommandRef.current) {
          // B: Only execute commands when this device is MASTER. CONTROL devices must never output audio.
          if (deviceModeRef.current === "MASTER") {
            onCommandRef.current({ command: data.command, payload: data.payload });
          }
        } else if (data.type === "STATE_UPDATE" && onStateUpdateRef.current) {
          onStateUpdateRef.current(data.state);
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      setMasterDeviceId(null);
    };
    ws.onerror = () => setStatus("error");

    return () => {
      ws.close();
      wsRef.current = null;
      setStatus("disconnected");
      setMasterDeviceId(null);
    };
  }, [role, deviceId, options?.isMobile]);

  const sendState = (state: StationPlaybackState) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "STATE_UPDATE", state } as ClientMessage));
    }
  };

  const sendSetMaster = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "SET_MASTER" } as ClientMessage));
    }
  };

  const sendSetControl = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "SET_CONTROL" } as ClientMessage));
    }
  };

  const sendCommand = (
    targetDeviceId: string,
    command: RemoteCommand,
    payload?: { url?: string; source?: unknown; position?: number; volume?: number }
  ) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "COMMAND", targetDeviceId, command, payload } as ClientMessage));
    }
  };

  return { status, wsRef, sendState, deviceMode, sendSetMaster, sendSetControl, masterDeviceId, sendCommand };
}

export type DeviceInfo = { id: string; connectedAt: string; mode?: DeviceMode };

export function useRemoteController() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [masterDeviceId, setMasterDeviceId] = useState<string | null>(null);
  const [remoteState, setRemoteState] = useState<Record<string, StationPlaybackState>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  const tryReconnect = () => {
    const ws = wsRef.current;
    const staleOrClosed = ws && (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING);
    const needsReconnect =
      statusRef.current === "disconnected" ||
      statusRef.current === "error" ||
      staleOrClosed;
    if (needsReconnect) setReconnectTrigger((k) => k + 1);
  };

  useEffect(() => {
    const url = getWsUrl();
    if (!url) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "REGISTER", role: "controller" } as ClientMessage));
      setStatus("connected");
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as ServerMessage;
        if (data.type === "DEVICE_LIST") {
          setDevices(data.devices);
          setMasterDeviceId(data.masterDeviceId ?? null);
        } else if (data.type === "STATE_UPDATE") {
          setRemoteState((prev) => ({ ...prev, [data.deviceId]: data.state }));
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      setDevices([]);
      setMasterDeviceId(null);
      setRemoteState({});
    };
    ws.onerror = () => setStatus("error");

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [reconnectTrigger]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") tryReconnect();
    };
    const onFocus = () => tryReconnect();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) tryReconnect();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const sendCommand = (
    targetDeviceId: string,
    command: RemoteCommand,
    payload?: { url?: string; source?: unknown; position?: number; volume?: number }
  ) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "COMMAND", targetDeviceId, command, payload } as ClientMessage));
  };

  return { devices, masterDeviceId, status, sendCommand, remoteState };
}
