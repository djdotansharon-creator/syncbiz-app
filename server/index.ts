/**
 * MVP WebSocket server for remote player control.
 * Run: cd server && npm install && npm run dev
 *
 * MASTER ownership (sticky + grace period + persistence):
 * - Device identity: deviceId from client (localStorage UUID, persistent per browser).
 * - Designated primary: the device that was last MASTER; ownership reserved on disconnect.
 * - Grace period: MASTER_GRACE_MS (default 90s) after primary disconnects before another desktop can auto-promote.
 * - Persistence: master lease stored in server/data/master-lease.json; survives server restarts.
 * - Temporary disconnect: primary reconnects within grace → gets MASTER back; secondaries stay CONTROL.
 * - Long offline: after grace expires, first desktop to register gets MASTER.
 * - Manual SET_MASTER: always allowed; overrides grace reservation.
 */

import { WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage, StationPlaybackState, DeviceMode, GuestRecommendationPayload, BranchSummary } from "../lib/remote-control/types";
import { loadLease, saveLease } from "./master-lease-store";

const PORT = Number(process.env.WS_PORT) || 3001;

/** Grace period (ms) before another desktop can become MASTER after primary disconnects. Default 90s. */
const MASTER_GRACE_MS = Number(process.env.MASTER_GRACE_MS) || 90_000;

const DEFAULT_BRANCH_ID = "default";

function branchKey(userId: string, branchId: string): string {
  return `${userId}:${branchId}`;
}

type DeviceConnection = {
  id: string;
  ws: import("ws").WebSocket;
  connectedAt: string;
  role: "device" | "controller";
  mode: DeviceMode;
  isMobile?: boolean;
  userId?: string;
  branchId: string;
};

const devices = new Map<string, DeviceConnection>();
type ControllerEntry = { ws: import("ws").WebSocket; userId: string; branchId: string };
const controllers: ControllerEntry[] = [];
type OwnerEntry = { ws: import("ws").WebSocket; userId: string };
const owners: OwnerEntry[] = [];

/** MASTER device ID per (userId, branchId). Key = branchKey(userId, branchId). Persisted to disk. */
const masterByBranch = new Map<string, string>();

/** When the designated MASTER disconnected (timestamp). Key = branchKey. Persisted to disk. */
const masterDisconnectedAt = new Map<string, number>();

/** Load persisted lease on startup. Supports legacy masterByUserId format. */
(function loadPersistedLease() {
  const snap = loadLease();
  Object.entries(snap.masterByBranch).forEach(([k, v]) => masterByBranch.set(k, v));
  Object.entries(snap.masterDisconnectedAt).forEach(([k, v]) => masterDisconnectedAt.set(k, v));
})();

function persistMasterLease() {
  saveLease({
    masterByBranch: Object.fromEntries(masterByBranch),
    masterDisconnectedAt: Object.fromEntries(masterDisconnectedAt),
  });
}

/** Last known playback state per device (station). */
const deviceState = new Map<string, StationPlaybackState>();

/** Session code (6-char) → userId. For guest targeting. */
const sessionCodeByUserId = new Map<string, string>();
const userIdBySessionCode = new Map<string, string>();

function getOrCreateSessionCode(userId: string): string {
  const existing = sessionCodeByUserId.get(userId);
  if (existing) return existing;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code: string;
  do {
    code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (userIdBySessionCode.has(code));
  sessionCodeByUserId.set(userId, code);
  userIdBySessionCode.set(code, userId);
  return code;
}

/** Pending guest recommendations by id. Source of truth. */
const pendingRecommendations = new Map<string, GuestRecommendationPayload>();

function inferSourceType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("youtube") || u.includes("youtu.be")) return "youtube";
  if (u.includes("soundcloud")) return "soundcloud";
  if (u.includes("spotify")) return "spotify";
  if (u.match(/\.(m3u8?|pls)(\?|$)/i)) return "winamp";
  if (u.startsWith("http")) return "stream-url";
  return "local";
}

/** Returns the currently connected MASTER device ID for a branch. Null if disconnected or grace-expired. */
function getMasterForBranch(userId: string, branchId: string): string | null {
  const key = branchKey(userId, branchId);
  const id = masterByBranch.get(key);
  if (!id) return null;
  const conn = devices.get(id);
  if (!conn || conn.ws.readyState !== 1) return null;
  return id;
}

/** Returns the designated MASTER device ID (reserved) even if disconnected, if within grace period. */
function getReservedMasterForBranch(userId: string, branchId: string): string | null {
  const key = branchKey(userId, branchId);
  const id = masterByBranch.get(key);
  if (!id) return null;
  const conn = devices.get(id);
  if (conn && conn.ws.readyState === 1) return id;
  const disconnectedAt = masterDisconnectedAt.get(key);
  if (!disconnectedAt) return null;
  if (Date.now() - disconnectedAt > MASTER_GRACE_MS) {
    masterByBranch.delete(key);
    masterDisconnectedAt.delete(key);
    persistMasterLease();
    return null;
  }
  return id;
}

/** Clear expired grace periods for a branch. */
function clearExpiredGracePeriods(userId: string, branchId: string) {
  const key = branchKey(userId, branchId);
  const disconnectedAt = masterDisconnectedAt.get(key);
  if (!disconnectedAt) return;
  if (Date.now() - disconnectedAt > MASTER_GRACE_MS) {
    masterByBranch.delete(key);
    masterDisconnectedAt.delete(key);
    persistMasterLease();
  }
}

/** Backward compat: get master for default branch (single-branch mode). */
function getMasterForUser(userId: string): string | null {
  return getMasterForBranch(userId, DEFAULT_BRANCH_ID);
}

function getReservedMasterForUser(userId: string): string | null {
  return getReservedMasterForBranch(userId, DEFAULT_BRANCH_ID);
}

function broadcastDeviceListForUserAndBranch(userId: string, branchId: string) {
  const list: { id: string; connectedAt: string; mode?: DeviceMode; branchId?: string }[] = [];
  devices.forEach((d) => {
    if (d.role === "device" && (d.userId ?? "") === userId && d.branchId === branchId) {
      list.push({ id: d.id, connectedAt: d.connectedAt, mode: d.mode, branchId: d.branchId });
    }
  });
  const masterDeviceId = getMasterForBranch(userId, branchId);
  const sessionCode = userId ? getOrCreateSessionCode(userId) : undefined;
  const msg: ServerMessage = { type: "DEVICE_LIST", devices: list, masterDeviceId, sessionCode };
  const raw = JSON.stringify(msg);
  controllers.forEach((c) => {
    if ((c.userId ?? "") === userId && c.branchId === branchId && c.ws.readyState === 1) c.ws.send(raw);
  });
  devices.forEach((d) => {
    if (d.role === "device" && (d.userId ?? "") === userId && d.branchId === branchId && d.ws.readyState === 1) {
      d.ws.send(raw);
    }
  });
}

function broadcastDeviceList() {
  const pairs = new Set<string>();
  controllers.forEach((c) => pairs.add(`${c.userId ?? ""}:${c.branchId}`));
  devices.forEach((d) => {
    if (d.role === "device") pairs.add(`${d.userId ?? ""}:${d.branchId}`);
  });
  pairs.forEach((p) => {
    const [uid, bid] = p.split(":");
    if (uid && bid) broadcastDeviceListForUserAndBranch(uid, bid);
  });
}

function broadcastStateUpdate(deviceId: string, state: StationPlaybackState, userId: string, branchId: string) {
  deviceState.set(deviceId, state);
  const msg: ServerMessage = { type: "STATE_UPDATE", deviceId, state };
  const raw = JSON.stringify(msg);
  controllers.forEach((c) => {
    if ((c.userId ?? "") === userId && c.branchId === branchId && c.ws.readyState === 1) c.ws.send(raw);
  });
  devices.forEach((d) => {
    if (d.role === "device" && (d.userId ?? "") === userId && d.branchId === branchId && d.id !== deviceId && d.ws.readyState === 1) {
      d.ws.send(raw);
    }
  });
  owners.forEach((o) => {
    if ((o.userId ?? "") === userId && o.ws.readyState === 1) o.ws.send(raw);
  });
}

function sendInitialStateToController(ws: import("ws").WebSocket, userId: string, branchId: string) {
  devices.forEach((d) => {
    if (d.role === "device" && (d.userId ?? "") === userId && d.branchId === branchId) {
      const state = deviceState.get(d.id);
      if (state) {
        const msg: ServerMessage = { type: "STATE_UPDATE", deviceId: d.id, state };
        if (ws.readyState === 1) ws.send(JSON.stringify(msg));
      }
    }
  });
}

/** Build branch list for owner: branches with connected MASTER devices for this userId. */
function getBranchListForOwner(userId: string): BranchSummary[] {
  const branches: BranchSummary[] = [];
  const seen = new Set<string>();
  masterByBranch.forEach((deviceId, key) => {
    if (!key.startsWith(userId + ":")) return;
    const branchId = key.slice(userId.length + 1);
    const conn = devices.get(deviceId);
    if (!conn || conn.ws.readyState !== 1 || conn.mode !== "MASTER") return;
    if (seen.has(branchId)) return;
    seen.add(branchId);
    let deviceCount = 0;
    devices.forEach((d) => {
      if (d.role === "device" && (d.userId ?? "") === userId && d.branchId === branchId) deviceCount++;
    });
    branches.push({
      branchId,
      masterDeviceId: deviceId,
      connectedAt: conn.connectedAt,
      hasDevices: deviceCount > 0,
    });
  });
  return branches;
}

function sendBranchListToOwner(ws: import("ws").WebSocket, userId: string) {
  const branches = getBranchListForOwner(userId);
  const msg: ServerMessage = { type: "BRANCH_LIST", branches };
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
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
      role = msg.role as "device" | "controller" | "owner_global";
      const branchId = (msg.branchId ?? "").trim() || DEFAULT_BRANCH_ID;

      if (msg.role === "owner_global") {
        const userId = (msg.userId ?? "").trim() || "";
        if (!userId) {
          ws.send(JSON.stringify({ type: "ERROR", message: "userId required for owner" } as ServerMessage));
          return;
        }
        owners.push({ ws, userId });
        ws.send(JSON.stringify({ type: "REGISTERED" } as ServerMessage));
        sendBranchListToOwner(ws, userId);
        return;
      }

      if (msg.role === "device" && msg.deviceId) {
        deviceId = msg.deviceId;
        const isMobile = msg.isMobile ?? false;
        const userId = (msg.userId ?? "").trim() || "";

        clearExpiredGracePeriods(userId, branchId);
        let mode: DeviceMode = "CONTROL";
        let secondaryDesktop = false;
        const reservedMasterId = getReservedMasterForBranch(userId, branchId);
        const key = branchKey(userId, branchId);

        if (!isMobile) {
          if (deviceId === reservedMasterId) {
            mode = "MASTER";
            masterDisconnectedAt.delete(key);
            masterByBranch.set(key, deviceId);
            persistMasterLease();
          } else if (reservedMasterId) {
            secondaryDesktop = true;
          } else {
            mode = "MASTER";
            masterByBranch.set(key, deviceId);
            persistMasterLease();
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
          branchId,
        });
        const sessionCode = userId ? getOrCreateSessionCode(userId) : undefined;
        const reply: ServerMessage = { type: "REGISTERED", deviceId, sessionCode };
        ws.send(JSON.stringify(reply));
        const masterDeviceIdForClient = getMasterForBranch(userId, branchId);
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
        controllers.push({ ws, userId, branchId });
        const sessionCode = userId ? getOrCreateSessionCode(userId) : undefined;
        const reply: ServerMessage = { type: "REGISTERED", sessionCode };
        ws.send(JSON.stringify(reply));
        broadcastDeviceListForUserAndBranch(userId, branchId);
        sendInitialStateToController(ws, userId, branchId);
      }
      return;
    }

    if (msg.type === "BRANCH_LIST_REQUEST" && role === "owner_global") {
      const owner = owners.find((o) => o.ws === ws);
      if (owner) sendBranchListToOwner(ws, owner.userId);
      return;
    }

    if (msg.type === "GUEST_RECOMMEND") {
      const sessionCode = (msg.sessionCode ?? "").trim().toUpperCase();
      const userId = userIdBySessionCode.get(sessionCode);
      if (!userId) {
        ws.send(JSON.stringify({ type: "ERROR", message: "Invalid session code" } as ServerMessage));
        return;
      }
      const sourceUrl = (msg.sourceUrl ?? "").trim();
      if (!sourceUrl || !sourceUrl.startsWith("http")) {
        ws.send(JSON.stringify({ type: "ERROR", message: "Valid URL required" } as ServerMessage));
        return;
      }
      const rec: GuestRecommendationPayload = {
        id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        sourceUrl,
        sourceType: inferSourceType(sourceUrl),
        guestName: msg.guestName?.trim() || undefined,
        guestMessage: msg.guestMessage?.trim() || undefined,
        createdAt: new Date().toISOString(),
        targetSessionId: userId,
        status: "pending",
      };
      pendingRecommendations.set(rec.id, rec);
      const forward: ServerMessage = { type: "GUEST_RECOMMEND_RECEIVED", recommendation: rec };
      const raw = JSON.stringify(forward);
      controllers.forEach((c) => {
        if ((c.userId ?? "") === userId && c.ws.readyState === 1) c.ws.send(raw);
      });
      devices.forEach((d) => {
        if (d.role === "device" && (d.userId ?? "") === userId && d.ws.readyState === 1) d.ws.send(raw);
      });
      ws.send(JSON.stringify({ type: "GUEST_RECOMMEND_SENT", recommendationId: rec.id } as ServerMessage));
      return;
    }

    if (msg.type === "APPROVE_GUEST_RECOMMEND" || msg.type === "REJECT_GUEST_RECOMMEND") {
      const rec = pendingRecommendations.get(msg.recommendationId);
      if (!rec) return;
      const userId = rec.targetSessionId;
      const conn = devices.get(deviceId!);
      const senderUserId = conn?.userId ?? (controllers.find((c) => c.ws === ws)?.userId ?? "");
      if (senderUserId !== userId) return;
      pendingRecommendations.delete(msg.recommendationId);
      rec.status = msg.type === "APPROVE_GUEST_RECOMMEND" ? "approved" : "rejected";
      const result: ServerMessage = { type: "GUEST_RECOMMEND_RESULT", recommendationId: msg.recommendationId, status: rec.status };
      const raw = JSON.stringify(result);
      controllers.forEach((c) => {
        if ((c.userId ?? "") === userId && c.ws.readyState === 1) c.ws.send(raw);
      });
      devices.forEach((d) => {
        if (d.role === "device" && (d.userId ?? "") === userId && d.ws.readyState === 1) d.ws.send(raw);
      });
      if (msg.type === "APPROVE_GUEST_RECOMMEND") {
        const masterId = getMasterForBranch(userId, DEFAULT_BRANCH_ID);
        const master = masterId ? devices.get(masterId) : null;
        if (master && master.ws.readyState === 1) {
          master.ws.send(JSON.stringify({
            type: "COMMAND",
            command: "PLAY_SOURCE",
            payload: {
              source: {
                id: rec.id,
                title: "Guest recommendation",
                genre: "Mixed",
                cover: null,
                type: rec.sourceType,
                url: rec.sourceUrl,
                origin: "source",
              },
            },
          } as ServerMessage));
        }
      }
      return;
    }

    if (msg.type === "STATE_UPDATE" && role === "device" && deviceId) {
      const conn = devices.get(deviceId);
      const userId = conn?.userId ?? "";
      const branchId = conn?.branchId ?? DEFAULT_BRANCH_ID;
      broadcastStateUpdate(deviceId, msg.state, userId, branchId);
      return;
    }

    if (msg.type === "SET_MASTER" && role === "device" && deviceId) {
      const conn = devices.get(deviceId);
      const isMobile = conn?.isMobile ?? false;
      const userId = conn?.userId ?? "";
      const branchId = conn?.branchId ?? DEFAULT_BRANCH_ID;
      const currentMasterId = getMasterForBranch(userId, branchId);
      // Mobile becoming MASTER must NOT demote desktop. Desktop becoming MASTER demotes other non-mobile masters.
      if (isMobile) {
        const currentMaster = currentMasterId ? devices.get(currentMasterId) : null;
        if (currentMaster && !currentMaster.isMobile) {
          return;
        }
      }
      const prevMasterId = currentMasterId && currentMasterId !== deviceId ? currentMasterId : null;
      const prevMaster = prevMasterId ? devices.get(prevMasterId) : null;
      if (prevMaster && prevMaster.ws.readyState === 1 && !prevMaster.isMobile) {
        prevMaster.mode = "CONTROL";
        prevMaster.ws.send(
          JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL", masterDeviceId: deviceId } as ServerMessage)
        );
      }
      const key = branchKey(userId, branchId);
      masterByBranch.set(key, deviceId);
      masterDisconnectedAt.delete(key);
      persistMasterLease();
      if (conn) conn.mode = "MASTER";
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "MASTER" } as ServerMessage));
      }
      devices.forEach((d) => {
        if (d.role === "device" && (d.userId ?? "") === userId && d.branchId === branchId && d.mode === "CONTROL" && d.ws.readyState === 1) {
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
      const branchId = conn?.branchId ?? DEFAULT_BRANCH_ID;
      const key = branchKey(userId, branchId);
      const designatedMasterId = masterByBranch.get(key);
      if (designatedMasterId !== deviceId) return;
      masterByBranch.delete(key);
      masterDisconnectedAt.delete(key);
      persistMasterLease();
      if (conn) conn.mode = "CONTROL";
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL" } as ServerMessage));
      }
      broadcastDeviceList();
      return;
    }

    if (msg.type === "COMMAND") {
      let masterId: string | null = null;
      if (role === "owner_global") {
        const owner = owners.find((o) => o.ws === ws);
        const userId = owner?.userId ?? "";
        const targetBranchId = (msg.targetBranchId ?? "").trim() || DEFAULT_BRANCH_ID;
        masterId = getMasterForBranch(userId, targetBranchId);
      } else {
        const userId = role === "controller"
          ? (controllers.find((c) => c.ws === ws)?.userId ?? "")
          : (devices.get(deviceId!)?.userId ?? "");
        const branchId = role === "controller"
          ? (controllers.find((c) => c.ws === ws)?.branchId ?? DEFAULT_BRANCH_ID)
          : (devices.get(deviceId!)?.branchId ?? DEFAULT_BRANCH_ID);
        masterId = getMasterForBranch(userId, branchId) ?? msg.targetDeviceId ?? null;
      }
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
        role === "owner_global" ||
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
      const branchId = conn?.branchId ?? DEFAULT_BRANCH_ID;
      const key = branchKey(userId, branchId);
      const designatedMasterId = masterByBranch.get(key);
      if (designatedMasterId === deviceId) {
        masterDisconnectedAt.set(key, Date.now());
        persistMasterLease();
      }
      devices.delete(deviceId);
      deviceState.delete(deviceId);
    }
    const cIdx = controllers.findIndex((c) => c.ws === ws);
    if (cIdx >= 0) controllers.splice(cIdx, 1);
    const oIdx = owners.findIndex((o) => o.ws === ws);
    if (oIdx >= 0) owners.splice(oIdx, 1);
    broadcastDeviceList();
  });
});

console.log(`[SyncBiz WS] Server listening on ws://localhost:${PORT} (MASTER_GRACE_MS=${MASTER_GRACE_MS})`);
