"use client";

/**
 * WebSocket client for remote control.
 * Connects to the WS server and handles registration + command listening.
 */

import { useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "./types";

function getWsUrl(): string {
  if (typeof window === "undefined") return "";
  const base = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";
  return base.replace(/^http/, "ws").replace(/\/$/, "");
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export function useRemoteControlWs(
  role: "device" | "controller",
  deviceId: string | null,
  onCommand?: (cmd: { command: string; payload?: { url?: string } }) => void
) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

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
          ? { type: "REGISTER", role: "device", deviceId: deviceId ?? undefined }
          : { type: "REGISTER", role: "controller" };
      ws.send(JSON.stringify(msg));
      setStatus("connected");
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as ServerMessage;
        if (data.type === "COMMAND" && onCommandRef.current) {
          onCommandRef.current({ command: data.command, payload: data.payload });
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("error");

    return () => {
      ws.close();
      wsRef.current = null;
      setStatus("disconnected");
    };
  }, [role, deviceId]);

  return { status, wsRef };
}

export type DeviceInfo = { id: string; connectedAt: string };

export function useRemoteController() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

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
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      setDevices([]);
    };
    ws.onerror = () => setStatus("error");

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const sendCommand = (targetDeviceId: string, command: "PLAY" | "PAUSE" | "LOAD_PLAYLIST", payload?: { url?: string }) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "COMMAND", targetDeviceId, command, payload } as ClientMessage));
  };

  return { devices, status, sendCommand };
}
