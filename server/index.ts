/**
 * MVP WebSocket server for remote player control.
 * Run: cd server && npm install && npm run dev
 */

import { WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "../lib/remote-control/types";

const PORT = Number(process.env.WS_PORT) || 3001;

type DeviceConnection = {
  id: string;
  ws: import("ws").WebSocket;
  connectedAt: string;
  role: "device" | "controller";
};

const devices = new Map<string, DeviceConnection>();
const controllers: import("ws").WebSocket[] = [];

function broadcastDeviceList() {
  const list: { id: string; connectedAt: string }[] = [];
  devices.forEach((d) => {
    if (d.role === "device") list.push({ id: d.id, connectedAt: d.connectedAt });
  });
  const msg: ServerMessage = { type: "DEVICE_LIST", devices: list };
  const raw = JSON.stringify(msg);
  controllers.forEach((ws) => {
    if (ws.readyState === 1) ws.send(raw);
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
        devices.set(deviceId, {
          id: deviceId,
          ws,
          connectedAt: new Date().toISOString(),
          role: "device",
        });
        const reply: ServerMessage = { type: "REGISTERED", deviceId };
        ws.send(JSON.stringify(reply));
        broadcastDeviceList();
      } else if (msg.role === "controller") {
        controllers.push(ws);
        const reply: ServerMessage = { type: "REGISTERED" };
        ws.send(JSON.stringify(reply));
        broadcastDeviceList();
      }
      return;
    }

    if (msg.type === "COMMAND" && role === "controller") {
      const target = devices.get(msg.targetDeviceId);
      if (!target || target.role !== "device") {
        ws.send(JSON.stringify({ type: "ERROR", message: "Device not found" } as ServerMessage));
        return;
      }
      const cmd: ServerMessage = {
        type: "COMMAND",
        command: msg.command,
        payload: msg.payload,
      };
      if (target.ws.readyState === 1) {
        target.ws.send(JSON.stringify(cmd));
      }
    }
  });

  ws.on("close", () => {
    if (deviceId) devices.delete(deviceId);
    const idx = controllers.indexOf(ws);
    if (idx >= 0) controllers.splice(idx, 1);
    broadcastDeviceList();
  });
});

console.log(`[SyncBiz WS] Server listening on ws://localhost:${PORT}`);
