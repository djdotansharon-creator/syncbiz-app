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
};

const devices = new Map<string, DeviceConnection>();
const controllers: import("ws").WebSocket[] = [];

/** Current MASTER device ID. Only one device can be MASTER. */
let masterDeviceId: string | null = null;

/** Last known playback state per device (station). */
const deviceState = new Map<string, StationPlaybackState>();

function broadcastDeviceList() {
  const list: { id: string; connectedAt: string; mode?: DeviceMode }[] = [];
  devices.forEach((d) => {
    if (d.role === "device") list.push({ id: d.id, connectedAt: d.connectedAt, mode: d.mode });
  });
  const msg: ServerMessage = { type: "DEVICE_LIST", devices: list, masterDeviceId };
  const raw = JSON.stringify(msg);
  controllers.forEach((ws) => {
    if (ws.readyState === 1) ws.send(raw);
  });
}

function broadcastStateUpdate(deviceId: string, state: StationPlaybackState) {
  deviceState.set(deviceId, state);
  const msg: ServerMessage = { type: "STATE_UPDATE", deviceId, state };
  const raw = JSON.stringify(msg);
  controllers.forEach((ws) => {
    if (ws.readyState === 1) ws.send(raw);
  });
  // Also send to other devices (CONTROL devices mirror master state)
  devices.forEach((d) => {
    if (d.role === "device" && d.id !== deviceId && d.ws.readyState === 1) {
      d.ws.send(raw);
    }
  });
}

function sendInitialStateToController(ws: import("ws").WebSocket) {
  deviceState.forEach((state, deviceId) => {
    const msg: ServerMessage = { type: "STATE_UPDATE", deviceId, state };
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
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
        // A: No auto-MASTER on connect. First desktop gets MASTER; first mobile gets CONTROL.
        // New devices always get CONTROL unless we have no MASTER and this is a desktop.
        let mode: DeviceMode = "CONTROL";
        if (masterDeviceId === null && !isMobile) {
          mode = "MASTER";
          masterDeviceId = deviceId;
        }
        devices.set(deviceId, {
          id: deviceId,
          ws,
          connectedAt: new Date().toISOString(),
          role: "device",
          mode,
          isMobile: msg.isMobile,
        });
        const reply: ServerMessage = { type: "REGISTERED", deviceId };
        ws.send(JSON.stringify(reply));
        const setModeMsg: ServerMessage =
          mode === "CONTROL" && masterDeviceId
            ? { type: "SET_DEVICE_MODE", mode, masterDeviceId }
            : { type: "SET_DEVICE_MODE", mode };
        ws.send(JSON.stringify(setModeMsg));
        if (mode === "CONTROL" && masterDeviceId) {
          const masterState = deviceState.get(masterDeviceId);
          if (masterState) {
            ws.send(JSON.stringify({ type: "STATE_UPDATE", deviceId: masterDeviceId, state: masterState } as ServerMessage));
          }
        }
        broadcastDeviceList();
      } else if (msg.role === "controller") {
        controllers.push(ws);
        const reply: ServerMessage = { type: "REGISTERED" };
        ws.send(JSON.stringify(reply));
        broadcastDeviceList();
        sendInitialStateToController(ws);
      }
      return;
    }

    if (msg.type === "STATE_UPDATE" && role === "device" && deviceId) {
      broadcastStateUpdate(deviceId, msg.state);
      return;
    }

    if (msg.type === "SET_MASTER" && role === "device" && deviceId) {
      const conn = devices.get(deviceId);
      const isMobile = conn?.isMobile ?? false;
      // Mobile becoming MASTER must NOT demote desktop. Desktop becoming MASTER demotes other non-mobile masters.
      if (isMobile) {
        const currentMaster = masterDeviceId ? devices.get(masterDeviceId) : null;
        if (currentMaster && !currentMaster.isMobile) {
          // Desktop is master; reject mobile's request to avoid demoting desktop
          return;
        }
      }
      const prevMaster = masterDeviceId && masterDeviceId !== deviceId ? devices.get(masterDeviceId) : null;
      if (prevMaster && prevMaster.ws.readyState === 1 && !prevMaster.isMobile) {
        prevMaster.mode = "CONTROL";
        prevMaster.ws.send(
          JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL", masterDeviceId: deviceId } as ServerMessage)
        );
      }
      masterDeviceId = deviceId;
      if (conn) conn.mode = "MASTER";
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "MASTER" } as ServerMessage));
      }
      // Notify all CONTROL devices of new master
      devices.forEach((d) => {
        if (d.role === "device" && d.mode === "CONTROL" && d.ws.readyState === 1) {
          d.ws.send(
            JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL", masterDeviceId: deviceId } as ServerMessage)
          );
        }
      });
      broadcastDeviceList();
      return;
    }

    if (msg.type === "SET_CONTROL" && role === "device" && deviceId) {
      if (masterDeviceId !== deviceId) return;
      masterDeviceId = null;
      const conn = devices.get(deviceId);
      if (conn) conn.mode = "CONTROL";
      // B: No auto-promotion. MASTER becomes CONTROL only by explicit user action.
      // Other devices stay CONTROL until they explicitly request SET_MASTER.
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL" } as ServerMessage));
      }
      broadcastDeviceList();
      return;
    }

    if (msg.type === "COMMAND") {
      // C: Always route to current MASTER only. Ignore stale targetDeviceId from controller.
      const targetId = masterDeviceId ?? msg.targetDeviceId;
      const target = targetId ? devices.get(targetId) : null;
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
        (role === "device" && deviceId && target.id === masterDeviceId && target.mode === "MASTER");
      if (canSend && target.ws.readyState === 1) {
        target.ws.send(JSON.stringify(cmd));
      }
    }
  });

  ws.on("close", () => {
    if (deviceId) {
      if (masterDeviceId === deviceId) {
        masterDeviceId = null;
        // A: No auto-promotion on disconnect. Remaining devices stay CONTROL.
      }
      devices.delete(deviceId);
      deviceState.delete(deviceId);
    }
    const idx = controllers.indexOf(ws);
    if (idx >= 0) controllers.splice(idx, 1);
    broadcastDeviceList();
  });
});

console.log(`[SyncBiz WS] Server listening on ws://localhost:${PORT}`);
