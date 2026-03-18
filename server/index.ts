/**
 * MVP WebSocket server for remote player control.
 * Run: cd server && npm install && npm run dev
 */

import { WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage, StationPlaybackState, DeviceMode } from "../lib/remote-control/types";

const PORT = Number(process.env.WS_PORT) || 3001;

type DeviceConnection = {
  id: string;
  ws: import("ws").WebSocket;
  connectedAt: string;
  role: "device" | "controller";
  mode: DeviceMode;
  isMobile?: boolean;
  userId?: string;
};

const devices = new Map<string, DeviceConnection>();
type ControllerEntry = { ws: import("ws").WebSocket; userId: string };
const controllers: ControllerEntry[] = [];

/** MASTER device ID per user. One MASTER per user; user-scoped sessions. */
const masterByUserId = new Map<string, string>();

/** Last known playback state per device (station). */
const deviceState = new Map<string, StationPlaybackState>();

function getMasterForUser(userId: string): string | null {
  const id = masterByUserId.get(userId);
  if (!id) return null;
  const conn = devices.get(id);
  if (!conn || conn.ws.readyState !== 1) return null;
  return id;
}

function broadcastDeviceListForUser(userId: string) {
  const list: { id: string; connectedAt: string; mode?: DeviceMode }[] = [];
  devices.forEach((d) => {
    if (d.role === "device" && (d.userId ?? "") === userId) {
      list.push({ id: d.id, connectedAt: d.connectedAt, mode: d.mode });
    }
  });
  const masterDeviceId = getMasterForUser(userId);
  const msg: ServerMessage = { type: "DEVICE_LIST", devices: list, masterDeviceId };
  const raw = JSON.stringify(msg);
  controllers.forEach((c) => {
    if ((c.userId ?? "") === userId && c.ws.readyState === 1) c.ws.send(raw);
  });
}

function broadcastDeviceList() {
  const userIds = new Set<string>();
  controllers.forEach((c) => userIds.add(c.userId ?? ""));
  devices.forEach((d) => {
    if (d.role === "device") userIds.add(d.userId ?? "");
  });
  userIds.forEach((uid) => broadcastDeviceListForUser(uid));
}

function broadcastStateUpdate(deviceId: string, state: StationPlaybackState, userId: string) {
  deviceState.set(deviceId, state);
  const msg: ServerMessage = { type: "STATE_UPDATE", deviceId, state };
  const raw = JSON.stringify(msg);
  controllers.forEach((c) => {
    if ((c.userId ?? "") === userId && c.ws.readyState === 1) c.ws.send(raw);
  });
  devices.forEach((d) => {
    if (d.role === "device" && (d.userId ?? "") === userId && d.id !== deviceId && d.ws.readyState === 1) {
      d.ws.send(raw);
    }
  });
}

function sendInitialStateToController(ws: import("ws").WebSocket, userId: string) {
  devices.forEach((d) => {
    if (d.role === "device" && (d.userId ?? "") === userId) {
      const state = deviceState.get(d.id);
      if (state) {
        const msg: ServerMessage = { type: "STATE_UPDATE", deviceId: d.id, state };
        if (ws.readyState === 1) ws.send(JSON.stringify(msg));
      }
    }
  });
}

function parseMessage(data: Buffer | ArrayBuffer | string | Buffer[]): ClientMessage | null {
  try {
    let str: string;
    if (typeof data === "string") str = data;
    else if (Buffer.isBuffer(data)) str = data.toString("utf-8");
    else if (data instanceof ArrayBuffer) str = Buffer.from(data).toString("utf-8");
    else if (Array.isArray(data) && data.length > 0) str = Buffer.concat(data).toString("utf-8");
    else return null;
    return JSON.parse(str) as ClientMessage;
  } catch {
    return null;
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  let deviceId: string | null = null;
  let role: "device" | "controller" | null = null;

  ws.on("message", (data) => {
    const msg = parseMessage(data);
    if (!msg) return;

    if (msg.type === "REGISTER") {
      role = msg.role;
      if (msg.role === "device" && msg.deviceId) {
        deviceId = msg.deviceId;
        const isMobile = msg.isMobile ?? false;
        const userId = (msg.userId ?? "").trim() || "";

        // User-aware MASTER logic:
        // 1. Desktop with no MASTER for this user → MASTER
        // 2. Desktop with existing MASTER for this user → CONTROL + secondaryDesktop
        // 3. Mobile → always CONTROL, never auto-promote
        let mode: DeviceMode = "CONTROL";
        let secondaryDesktop = false;
        const existingMasterId = getMasterForUser(userId);

        if (!isMobile) {
          if (!existingMasterId) {
            mode = "MASTER";
            masterByUserId.set(userId, deviceId);
          } else {
            secondaryDesktop = true;
          }
        }

        devices.set(deviceId, {
          id: deviceId,
          ws,
          connectedAt: new Date().toISOString(),
          role: "device",
          mode,
          isMobile: msg.isMobile,
          userId,
        });
        const reply: ServerMessage = { type: "REGISTERED", deviceId };
        ws.send(JSON.stringify(reply));
        const masterDeviceIdForClient = getMasterForUser(userId);
        const setModeMsg: ServerMessage =
          mode === "CONTROL" && masterDeviceIdForClient
            ? { type: "SET_DEVICE_MODE", mode, masterDeviceId: masterDeviceIdForClient, secondaryDesktop }
            : { type: "SET_DEVICE_MODE", mode, secondaryDesktop };
        ws.send(JSON.stringify(setModeMsg));
        if (mode === "CONTROL" && masterDeviceIdForClient) {
          const masterState = deviceState.get(masterDeviceIdForClient);
          if (masterState) {
            ws.send(JSON.stringify({ type: "STATE_UPDATE", deviceId: masterDeviceIdForClient, state: masterState } as ServerMessage));
          }
        }
        broadcastDeviceList();
      } else if (msg.role === "controller") {
        const userId = (msg.userId ?? "").trim() || "";
        controllers.push({ ws, userId });
        const reply: ServerMessage = { type: "REGISTERED" };
        ws.send(JSON.stringify(reply));
        broadcastDeviceListForUser(userId);
        sendInitialStateToController(ws, userId);
      }
      return;
    }

    if (msg.type === "STATE_UPDATE" && role === "device" && deviceId) {
      const conn = devices.get(deviceId);
      const userId = conn?.userId ?? "";
      broadcastStateUpdate(deviceId, msg.state, userId);
      return;
    }

    if (msg.type === "SET_MASTER" && role === "device" && deviceId) {
      const conn = devices.get(deviceId);
      const isMobile = conn?.isMobile ?? false;
      const userId = conn?.userId ?? "";
      const currentMasterId = getMasterForUser(userId);
      // Mobile becoming MASTER must NOT demote desktop. Desktop becoming MASTER demotes other non-mobile masters.
      if (isMobile) {
        const currentMaster = currentMasterId ? devices.get(currentMasterId) : null;
        if (currentMaster && !currentMaster.isMobile) {
          return;
        }
      }
      const prevMaster = currentMasterId && currentMasterId !== deviceId ? devices.get(currentMasterId) : null;
      if (prevMaster && prevMaster.ws.readyState === 1 && !prevMaster.isMobile) {
        prevMaster.mode = "CONTROL";
        prevMaster.ws.send(
          JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL", masterDeviceId: deviceId } as ServerMessage)
        );
      }
      masterByUserId.set(userId, deviceId);
      if (conn) conn.mode = "MASTER";
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "MASTER" } as ServerMessage));
      }
      devices.forEach((d) => {
        if (d.role === "device" && (d.userId ?? "") === userId && d.mode === "CONTROL" && d.ws.readyState === 1) {
          d.ws.send(
            JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL", masterDeviceId: deviceId } as ServerMessage)
          );
        }
      });
      broadcastDeviceList();
      return;
    }

    if (msg.type === "SET_CONTROL" && role === "device" && deviceId) {
      const conn = devices.get(deviceId);
      const userId = conn?.userId ?? "";
      const currentMasterId = getMasterForUser(userId);
      if (currentMasterId !== deviceId) return;
      masterByUserId.delete(userId);
      if (conn) conn.mode = "CONTROL";
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL" } as ServerMessage));
      }
      broadcastDeviceList();
      return;
    }

    if (msg.type === "COMMAND") {
      // C: Always route to current MASTER only. Need userId to resolve master.
      const userId = role === "controller"
        ? (controllers.find((c) => c.ws === ws)?.userId ?? "")
        : (devices.get(deviceId!)?.userId ?? "");
      const masterId = getMasterForUser(userId) ?? msg.targetDeviceId;
      const target = masterId ? devices.get(masterId) : null;
      if (!target || target.role !== "device" || target.mode !== "MASTER") {
        ws.send(JSON.stringify({ type: "ERROR", message: "No MASTER device" } as ServerMessage));
        return;
      }
      const cmd: ServerMessage = {
        type: "COMMAND",
        command: msg.command,
        payload: msg.payload,
      };
      const canSend =
        role === "controller" ||
        (role === "device" && deviceId && target.id === masterId && target.mode === "MASTER");
      if (canSend && target.ws.readyState === 1) {
        target.ws.send(JSON.stringify(cmd));
      }
    }
  });

  ws.on("close", () => {
    if (deviceId) {
      const conn = devices.get(deviceId);
      const userId = conn?.userId ?? "";
      const currentMasterId = getMasterForUser(userId);
      if (currentMasterId === deviceId) {
        masterByUserId.delete(userId);
      }
      devices.delete(deviceId);
      deviceState.delete(deviceId);
    }
    const idx = controllers.findIndex((c) => c.ws === ws);
    if (idx >= 0) controllers.splice(idx, 1);
    broadcastDeviceList();
  });
});

console.log(`[SyncBiz WS] Server listening on ws://localhost:${PORT}`);
