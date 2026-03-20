"use client";

/**
 * WebSocket client for remote control.
 * Connects to the WS server and handles registration + command listening.
 */

import { useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, StationPlaybackState, DeviceMode, DeviceInfo, RemoteCommand, GuestRecommendationPayload, BranchSummary } from "./types";

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
  options?: {
    isMobile?: boolean;
    onStateUpdate?: (state: StationPlaybackState) => void;
    authToken?: string | null;
    onSecondaryDesktop?: () => void;
    onGuestRecommendation?: (recommendation: GuestRecommendationPayload) => void;
  }
) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("CONTROL");
  const [masterDeviceId, setMasterDeviceId] = useState<string | null>(null);
  const [hasExistingMaster, setHasExistingMaster] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const onCommandRef = useRef(onCommand);
  const onDeviceModeRef = useRef(onDeviceMode);
  const onStateUpdateRef = useRef(options?.onStateUpdate);
  const onSecondaryDesktopRef = useRef(options?.onSecondaryDesktop);
  const onGuestRecommendationRef = useRef(options?.onGuestRecommendation);
  const deviceModeRef = useRef<DeviceMode>("CONTROL");
  onCommandRef.current = onCommand;
  onDeviceModeRef.current = onDeviceMode;
  onStateUpdateRef.current = options?.onStateUpdate;
  onSecondaryDesktopRef.current = options?.onSecondaryDesktop;
  onGuestRecommendationRef.current = options?.onGuestRecommendation;
  deviceModeRef.current = deviceMode;

  useEffect(() => {
    if (role === "device" && !deviceId) return;
    const authToken = options?.authToken?.trim();
    if (!authToken) return;

    const url = getWsUrl();
    if (!url) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Opera Mobi|Silk|Mobile/i.test(ua);
      const msg: ClientMessage =
        role === "device"
          ? { type: "REGISTER", role: "device", authToken, deviceId: deviceId ?? undefined, isMobile, branchId: "default" }
          : { type: "REGISTER", role: "controller", authToken, branchId: "default" };
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
          setHasExistingMaster(!!("secondaryDesktop" in data && data.secondaryDesktop));
          onDeviceModeRef.current?.(data.mode);
          if ("secondaryDesktop" in data && data.secondaryDesktop) {
            onSecondaryDesktopRef.current?.();
          }
        } else if (data.type === "COMMAND" && onCommandRef.current) {
          if (deviceModeRef.current === "MASTER") {
            onCommandRef.current({ command: data.command, payload: data.payload });
          }
        } else if (data.type === "STATE_UPDATE" && onStateUpdateRef.current) {
          onStateUpdateRef.current(data.state);
        } else if (data.type === "REGISTERED" && "sessionCode" in data) {
          if (data.sessionCode) setSessionCode(data.sessionCode);
        } else if (data.type === "DEVICE_LIST" && "sessionCode" in data) {
          if (data.sessionCode) setSessionCode(data.sessionCode);
        } else if (data.type === "GUEST_RECOMMEND_RECEIVED" && onGuestRecommendationRef.current) {
          onGuestRecommendationRef.current(data.recommendation);
        } else if (data.type === "ERROR") {
          setStatus("error");
          ws.close();
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      setMasterDeviceId(null);
      setHasExistingMaster(false);
      setSessionCode(null);
    };
    ws.onerror = () => setStatus("error");

    return () => {
      ws.close();
      wsRef.current = null;
      setStatus("disconnected");
      setMasterDeviceId(null);
    };
  }, [role, deviceId, options?.authToken]);

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

  const sendApproveGuestRecommend = (recommendationId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "APPROVE_GUEST_RECOMMEND", recommendationId } as ClientMessage));
    }
  };

  const sendRejectGuestRecommend = (recommendationId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "REJECT_GUEST_RECOMMEND", recommendationId } as ClientMessage));
    }
  };

  return {
    status,
    wsRef,
    sendState,
    deviceMode,
    sendSetMaster,
    sendSetControl,
    masterDeviceId,
    hasExistingMaster,
    sendCommand,
    sessionCode,
    sendApproveGuestRecommend,
    sendRejectGuestRecommend,
  };
}

export type { DeviceInfo };

export function useRemoteController(options?: {
  onGuestRecommendation?: (recommendation: GuestRecommendationPayload) => void;
}) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [masterDeviceId, setMasterDeviceId] = useState<string | null>(null);
  const [remoteState, setRemoteState] = useState<Record<string, StationPlaybackState>>({});
  const [wsToken, setWsToken] = useState<string | null>(null);
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const statusRef = useRef(status);
  const onGuestRecommendationRef = useRef(options?.onGuestRecommendation);
  statusRef.current = status;
  onGuestRecommendationRef.current = options?.onGuestRecommendation;

  useEffect(() => {
    let cancelled = false;
    const fetchToken = (retry = false) => {
      fetch("/api/auth/ws-token")
        .then((r) => {
          if (cancelled) return;
          if (r.status === 401) {
            setWsToken(null);
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
          setWsToken(data?.token ?? null);
        })
        .catch(() => {
          if (cancelled) return;
          setWsToken(null);
        });
    };
    fetchToken();
    return () => { cancelled = true; };
  }, [reconnectTrigger]);

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
    const authToken = (wsToken ?? "").trim();
    if (!url || !authToken) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "REGISTER", role: "controller", authToken, branchId: "default" } as ClientMessage));
      setStatus("connected");
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as ServerMessage;
        if (data.type === "ERROR") {
          setStatus("error");
          ws.close();
          return;
        }
        if (data.type === "DEVICE_LIST") {
          setDevices(data.devices);
          setMasterDeviceId(data.masterDeviceId ?? null);
          if ("sessionCode" in data && data.sessionCode) setSessionCode(data.sessionCode);
        } else if (data.type === "STATE_UPDATE") {
          setRemoteState((prev) => ({ ...prev, [data.deviceId]: data.state }));
        } else if (data.type === "GUEST_RECOMMEND_RECEIVED" && onGuestRecommendationRef.current) {
          onGuestRecommendationRef.current(data.recommendation);
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
      setSessionCode(null);
    };
    ws.onerror = () => setStatus("error");

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [reconnectTrigger, wsToken]);

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

  const sendApproveGuestRecommend = (recommendationId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "APPROVE_GUEST_RECOMMEND", recommendationId } as ClientMessage));
    }
  };

  const sendRejectGuestRecommend = (recommendationId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "REJECT_GUEST_RECOMMEND", recommendationId } as ClientMessage));
    }
  };

  return {
    devices,
    masterDeviceId,
    status,
    sendCommand,
    remoteState,
    sessionCode,
    sendApproveGuestRecommend,
    sendRejectGuestRecommend,
  };
}

/** Owner global controller – connect from anywhere, target any branch. */
export function useRemoteOwner() {
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [remoteStateByDeviceId, setRemoteStateByDeviceId] = useState<Record<string, StationPlaybackState>>({});
  const [wsToken, setWsToken] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [reconnectTrigger, setReconnectTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchToken = (retry = false) => {
      fetch("/api/auth/ws-token")
        .then((r) => {
          if (cancelled) return;
          if (r.status === 401) {
            setWsToken(null);
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
          setWsToken(data?.token ?? null);
        })
        .catch(() => {
          if (cancelled) return;
          setWsToken(null);
        });
    };
    fetchToken();
    return () => { cancelled = true; };
  }, [reconnectTrigger]);

  useEffect(() => {
    const url = getWsUrl();
    const authToken = (wsToken ?? "").trim();
    if (!url || !authToken) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "REGISTER", role: "owner_global", authToken } as ClientMessage));
      setStatus("connected");
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as ServerMessage;
        if (data.type === "ERROR") {
          setStatus("error");
          ws.close();
          return;
        }
        if (data.type === "BRANCH_LIST") {
          setBranches(data.branches);
          setSelectedBranchId((prev) => (prev ? prev : data.branches[0]?.branchId ?? null));
        } else if (data.type === "STATE_UPDATE") {
          setRemoteStateByDeviceId((prev) => ({ ...prev, [data.deviceId]: data.state }));
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      setBranches([]);
      setRemoteStateByDeviceId({});
    };
    ws.onerror = () => setStatus("error");

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [reconnectTrigger, wsToken]);

  const refreshBranchList = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "BRANCH_LIST_REQUEST" } as ClientMessage));
    }
  };

  const sendCommand = (
    command: RemoteCommand,
    payload?: { url?: string; source?: unknown; position?: number; volume?: number }
  ) => {
    const ws = wsRef.current;
    const bid = selectedBranchId;
    if (!ws || ws.readyState !== 1 || !bid) return;
    ws.send(JSON.stringify({ type: "COMMAND", targetBranchId: bid, command, payload } as ClientMessage));
  };

  const selectedBranch = branches.find((b) => b.branchId === selectedBranchId);
  const remoteState = selectedBranch ? remoteStateByDeviceId[selectedBranch.masterDeviceId] ?? null : null;

  return {
    branches,
    selectedBranchId,
    setSelectedBranchId,
    selectedBranch,
    remoteState,
    status,
    sendCommand,
    refreshBranchList,
  };
}
