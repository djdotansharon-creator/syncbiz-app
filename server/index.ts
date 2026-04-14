/**
 * MVP WebSocket server for remote player control.
 * Run: cd server && npm install && npm run dev
 *
 * Required env: SYNCBIZ_WS_SECRET or WS_SECRET (min 16 chars)
 * Loads ../.env so dev:all uses same secret as Next.js.
 */

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

/** Primary MASTER eligibility (desktop-only):
 * - Only non-mobile desktop devices may own the primary branch MASTER lease.
 * - Mobile devices must NEVER claim or persist primary branch ownership.
 * - masterByBranch stores only desktop device IDs; mobile is never written.
 * - If mobile connects first, it may play (auxiliary) but does not reserve primary.
 * - First eligible desktop to connect becomes MASTER immediately.
 *
 * MASTER ownership (sticky + grace period + persistence):
 * - Device identity: deviceId from client (localStorage UUID, persistent per browser).
 * - Designated primary: the desktop that was last MASTER; ownership reserved on disconnect.
 * - Grace period: MASTER_GRACE_MS (default 90s) after primary disconnects before another desktop can auto-promote.
 * - Persistence: master lease stored in server/data/master-lease.json; survives server restarts.
 * - Temporary disconnect: primary reconnects within grace → gets MASTER back; secondaries stay CONTROL.
 * - Long offline: after grace expires, first desktop to register gets MASTER.
 * - Manual SET_MASTER: desktop may take MASTER while another desktop is still connected; demotes
 *   other MASTERs and updates primary + master maps together (explicit handoff).
 */

import { createServer } from "http";
import { WebSocketServer } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  StationPlaybackState,
  DeviceMode,
  GuestRecommendationPayload,
  BranchSummary,
  DeviceInfo,
} from "../lib/remote-control/types.js";
import { sanitizeRegistrationIntent, type SyncBizRegistrationIntent } from "./syncbiz-device-model.js";
import { loadLease, saveLease } from "./master-lease-store.js";
import { verifyWsToken } from "./ws-token.js";

const WS_SECRET = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;
if (!WS_SECRET || WS_SECRET.length < 16) {
  console.error("[SyncBiz WS] SYNCBIZ_WS_SECRET or WS_SECRET required (min 16 chars). Exiting.");
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3001;
const REGISTER_TIMEOUT_MS = 5000;
const ALLOWED_BRANCH_IDS = ["default"] as const;

/** Heartbeat: ping interval (ms). Default 30s. */
const HEARTBEAT_PING_INTERVAL_MS = Number(process.env.HEARTBEAT_PING_INTERVAL_MS) || 30_000;
/** Close socket if no pong received within this window (ms). Default 90s. */
const HEARTBEAT_PONG_TIMEOUT_MS = Number(process.env.HEARTBEAT_PONG_TIMEOUT_MS) || 90_000;
/** Presence: lastSeen within this window (ms) = online; older = stale. Default 60s. */
const PRESENCE_ONLINE_THRESHOLD_MS = Number(process.env.PRESENCE_ONLINE_THRESHOLD_MS) || 60_000;

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
  lastSeen: string;
  role: "device" | "controller";
  mode: DeviceMode;
  isMobile?: boolean;
  userId?: string;
  branchId: string;
  /** Sanitized REGISTER hint from client (optional). */
  registrationIntent?: SyncBizRegistrationIntent;
};

const devices = new Map<string, DeviceConnection>();
type ControllerEntry = { ws: import("ws").WebSocket; userId: string; branchId: string };
const controllers: ControllerEntry[] = [];
type OwnerEntry = { ws: import("ws").WebSocket; userId: string };
const owners: OwnerEntry[] = [];

/** Per-socket heartbeat: last pong timestamp. Used to detect stale connections. */
const socketLastPongAt = new Map<import("ws").WebSocket, number>();

/** MASTER device ID per (userId, branchId). Key = branchKey(userId, branchId). Persisted to disk. */
const masterByBranch = new Map<string, string>();

/** When the designated MASTER disconnected (timestamp). Key = branchKey. Persisted to disk. */
const masterDisconnectedAt = new Map<string, number>();

/** Designated primary MASTER per branch. Only this device can be MASTER. Persisted to disk. */
const primaryMasterByBranch = new Map<string, string>();

/** Load persisted lease on startup. Supports legacy masterByUserId format. */
(function loadPersistedLease() {
  const snap = loadLease();
  Object.entries(snap.masterByBranch).forEach(([k, v]) => masterByBranch.set(k, v as string));
  Object.entries(snap.masterDisconnectedAt).forEach(([k, v]) => masterDisconnectedAt.set(k, v as number));
  if (snap.primaryMasterByBranch) {
    Object.entries(snap.primaryMasterByBranch).forEach(([k, v]) => primaryMasterByBranch.set(k, v as string));
  }
})();

function persistMasterLease() {
  saveLease({
    masterByBranch: Object.fromEntries(masterByBranch),
    masterDisconnectedAt: Object.fromEntries(masterDisconnectedAt),
    primaryMasterByBranch: Object.fromEntries(primaryMasterByBranch),
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

/** Returns the currently connected primary MASTER device ID for a branch. Desktop-only; null if disconnected, mobile, or grace-expired. */
function getMasterForBranch(userId: string, branchId: string): string | null {
  const key = branchKey(userId, branchId);
  const id = masterByBranch.get(key);
  if (!id) return null;
  const conn = devices.get(id);
  if (!conn || conn.ws.readyState !== 1) return null;
  if (conn.isMobile) {
    masterByBranch.delete(key);
    masterDisconnectedAt.delete(key);
    primaryMasterByBranch.delete(key);
    persistMasterLease();
    return null;
  }
  return id;
}

/** Returns the designated primary MASTER device ID (reserved) even if disconnected, if within grace period. Desktop-only. */
function getReservedMasterForBranch(userId: string, branchId: string): string | null {
  const key = branchKey(userId, branchId);
  const id = masterByBranch.get(key);
  if (!id) return null;
  const conn = devices.get(id);
  if (conn) {
    if (conn.isMobile) {
      masterByBranch.delete(key);
      masterDisconnectedAt.delete(key);
      primaryMasterByBranch.delete(key);
      persistMasterLease();
      return null;
    }
    if (conn.ws.readyState === 1) return id;
  }
  const disconnectedAt = masterDisconnectedAt.get(key);
  if (!disconnectedAt) return null;
  if (Date.now() - disconnectedAt > MASTER_GRACE_MS) {
    masterByBranch.delete(key);
    masterDisconnectedAt.delete(key);
    primaryMasterByBranch.delete(key);
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
    primaryMasterByBranch.delete(key);
    persistMasterLease();
  }
}

function isEligibleConnectedPlaybackCandidate(d: DeviceConnection, userId: string, branchId: string): boolean {
  if (d.role !== "device") return false;
  if ((d.userId ?? "") !== userId || d.branchId !== branchId) return false;
  if (d.ws.readyState !== 1) return false;
  if (d.isMobile) return false;
  const intent = d.registrationIntent;
  if (!intent) return true;
  return (
    intent.runtimeMode === "branch_playback" &&
    (intent.devicePurpose === "branch_desktop_station" || intent.devicePurpose === "branch_web_station")
  );
}

function tryPromoteConnectedControlOnMasterLoss(userId: string, branchId: string): string | null {
  let candidate: DeviceConnection | null = null;
  devices.forEach((d) => {
    if (!isEligibleConnectedPlaybackCandidate(d, userId, branchId)) return;
    if (d.mode !== "CONTROL") return;
    if (!candidate || d.connectedAt < candidate.connectedAt) {
      candidate = d;
    }
  });
  if (!candidate) return null;
  const selected: DeviceConnection = candidate as DeviceConnection;

  const key = branchKey(userId, branchId);
  devices.forEach((d) => {
    if (
      d.role === "device" &&
      (d.userId ?? "") === userId &&
      d.branchId === branchId &&
      d.id !== selected.id &&
      d.mode === "MASTER" &&
      d.ws.readyState === 1
    ) {
      d.mode = "CONTROL";
      d.ws.send(
        JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL", masterDeviceId: selected.id } as ServerMessage)
      );
    }
  });

  selected.mode = "MASTER";
  masterByBranch.set(key, selected.id);
  primaryMasterByBranch.set(key, selected.id);
  masterDisconnectedAt.delete(key);
  persistMasterLease();
  if (selected.ws.readyState === 1) {
    selected.ws.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "MASTER" } as ServerMessage));
  }
  return selected.id;
}

function isTrueMasterLossCloseCode(code: number): boolean {
  // Explicit app/tab close, process exit/no close frame, abnormal peer loss, or heartbeat timeout.
  // These are the close paths we should fail over from when a connected eligible CONTROL already exists.
  return code === 1000 || code === 1001 || code === 1005 || code === 1006 || code === 4006;
}

/** Backward compat: get master for default branch (single-branch mode). */
function getMasterForUser(userId: string): string | null {
  return getMasterForBranch(userId, DEFAULT_BRANCH_ID);
}

function getReservedMasterForUser(userId: string): string | null {
  return getReservedMasterForBranch(userId, DEFAULT_BRANCH_ID);
}

function broadcastLibraryUpdated(userId: string, branchId: string, entityType?: "playlist" | "source" | "radio", action?: "created" | "updated" | "deleted") {
  const msg: ServerMessage = { type: "LIBRARY_UPDATED", branchId, entityType, action };
  const raw = JSON.stringify(msg);
  controllers.forEach((c) => {
    if ((c.userId ?? "") === userId && c.branchId === branchId && c.ws.readyState === 1) c.ws.send(raw);
  });
  devices.forEach((d) => {
    if (d.role === "device" && (d.userId ?? "") === userId && d.branchId === branchId && d.ws.readyState === 1) {
      d.ws.send(raw);
    }
  });
  owners.forEach((o) => {
    if ((o.userId ?? "") === userId && o.ws.readyState === 1) o.ws.send(raw);
  });
}

function broadcastDeviceListForUserAndBranch(userId: string, branchId: string) {
  const now = Date.now();
  const list: DeviceInfo[] = [];
  devices.forEach((d) => {
    if (d.role === "device" && (d.userId ?? "") === userId && d.branchId === branchId) {
      const lastSeenMs = d.lastSeen ? new Date(d.lastSeen).getTime() : now;
      const presence = now - lastSeenMs <= PRESENCE_ONLINE_THRESHOLD_MS ? "online" : "stale";
      list.push({
        id: d.id,
        connectedAt: d.connectedAt,
        lastSeen: d.lastSeen,
        presence,
        mode: d.mode,
        branchId: d.branchId,
        registrationIntent: d.registrationIntent,
      });
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

/** Build branch list for owner: branches with connected desktop MASTER devices for this userId. */
function getBranchListForOwner(userId: string): BranchSummary[] {
  const branches: BranchSummary[] = [];
  const seen = new Set<string>();
  masterByBranch.forEach((deviceId, key) => {
    if (!key.startsWith(userId + ":")) return;
    const branchId = key.slice(userId.length + 1);
    const conn = devices.get(deviceId);
    if (!conn || conn.ws.readyState !== 1 || conn.mode !== "MASTER" || conn.isMobile) return;
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

function isBranchAuthorized(branchId: string): boolean {
  const normalized = (branchId ?? "").trim() || DEFAULT_BRANCH_ID;
  return (ALLOWED_BRANCH_IDS as unknown as string[]).includes(normalized);
}

function validateRegisterPayload(
  msg: unknown
): { ok: true; role: string; branchId: string; deviceId?: string; authToken: string } | { ok: false; error: string } {
  if (!msg || typeof msg !== "object") return { ok: false, error: "Invalid message" };
  const m = msg as Record<string, unknown>;
  if (m.type !== "REGISTER") return { ok: false, error: "Invalid message type" };
  const role = m.role;
  if (!role || !["device", "controller", "owner_global"].includes(role as string)) {
    return { ok: false, error: "Invalid role" };
  }
  const authToken = typeof m.authToken === "string" ? m.authToken.trim() : "";
  if (!authToken) return { ok: false, error: "Authentication required" };
  const branchId = (typeof m.branchId === "string" ? m.branchId : "").trim() || DEFAULT_BRANCH_ID;
  if (!isBranchAuthorized(branchId)) return { ok: false, error: "Branch not authorized" };
  if (role === "device") {
    const deviceId = typeof m.deviceId === "string" ? m.deviceId.trim() : "";
    if (!deviceId) return { ok: false, error: "deviceId required for device registration" };
    return { ok: true, role: role as string, branchId, deviceId, authToken };
  }
  return { ok: true, role: role as string, branchId, authToken };
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

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method === "POST" && req.url === "/internal/library-updated") {
    const secret = req.headers["x-syncbiz-secret"] ?? req.headers["x-syncbiz-internal-secret"];
    if (secret !== WS_SECRET) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const data = body ? (JSON.parse(body) as { userId?: string; branchId?: string; entityType?: "playlist" | "source" | "radio"; action?: "created" | "updated" | "deleted" }) : {};
        const userId = typeof data.userId === "string" ? data.userId.trim() : "";
        const branchId = (typeof data.branchId === "string" ? data.branchId.trim() : "") || DEFAULT_BRANCH_ID;
        if (userId) {
          broadcastLibraryUpdated(userId, branchId, data.entityType, data.action);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "userId required" }));
        }
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  let deviceId: string | null = null;
  let role: "device" | "controller" | "owner_global" | null = null;
  let registered = false;

  socketLastPongAt.set(ws, Date.now());
  ws.on("pong", () => {
    socketLastPongAt.set(ws, Date.now());
    const nowIso = new Date().toISOString();
    devices.forEach((d) => {
      if (d.ws === ws) {
        d.lastSeen = nowIso;
      }
    });
  });

  console.log("[SyncBiz WS] connect");

  const timeout = setTimeout(() => {
    if (!registered) {
      ws.close(4001, "REGISTER timeout");
    }
  }, REGISTER_TIMEOUT_MS);

  ws.on("message", (data) => {
    if (!registered) {
      const msg = parseMessage(data);
      if (!msg) {
        clearTimeout(timeout);
        ws.close(4002, "Malformed message");
        return;
      }
      if (msg.type !== "REGISTER") {
        clearTimeout(timeout);
        ws.close(4003, "First message must be REGISTER");
        return;
      }
      const validation = validateRegisterPayload(msg);
      if (!validation.ok) {
        clearTimeout(timeout);
        ws.send(JSON.stringify({ type: "ERROR", message: validation.error } as ServerMessage));
        ws.close(4004, validation.error);
        return;
      }
      const userId = verifyWsToken(validation.authToken);
      if (!userId) {
        clearTimeout(timeout);
        ws.send(JSON.stringify({ type: "ERROR", message: "Invalid or expired token" } as ServerMessage));
        ws.close(4005, "Invalid token");
        return;
      }
      registered = true;
      clearTimeout(timeout);
      role = validation.role as "device" | "controller" | "owner_global";
      const branchId = validation.branchId;

      if (role === "owner_global") {
        const regIntent = sanitizeRegistrationIntent(
          (msg as { registrationIntent?: unknown }).registrationIntent
        );
        if (process.env.NODE_ENV === "development" && regIntent) {
          console.info("[SyncBiz WS] register owner_global intent", regIntent);
        }
        owners.push({ ws, userId });
        ws.send(JSON.stringify({ type: "REGISTERED" } as ServerMessage));
        sendBranchListToOwner(ws, userId);
        console.log("[SyncBiz WS] register owner", { userId });
        return;
      }

      if (role === "device" && validation.deviceId) {
        deviceId = validation.deviceId;
        const isMobile = (msg as { isMobile?: boolean }).isMobile ?? false;
        const registrationIntent = sanitizeRegistrationIntent(
          (msg as { registrationIntent?: unknown }).registrationIntent
        );

        clearExpiredGracePeriods(userId, branchId);
        let mode: DeviceMode = "CONTROL";
        let secondaryDesktop = false;
        const key = branchKey(userId, branchId);
        const primaryId = primaryMasterByBranch.get(key);
        let reservedMasterId: string | null = null;
        let masterDecisionReason = "";

        if (isMobile) {
          if (masterByBranch.get(key) === deviceId) {
            masterByBranch.delete(key);
            masterDisconnectedAt.delete(key);
            if (primaryMasterByBranch.get(key) === deviceId) primaryMasterByBranch.delete(key);
            persistMasterLease();
          }
          masterDecisionReason = "mobile: never claim primary MASTER lease";
        } else if (primaryId) {
          if (deviceId === primaryId) {
            mode = "MASTER";
            masterDisconnectedAt.delete(key);
            masterByBranch.set(key, deviceId);
            persistMasterLease();
            masterDecisionReason = "desktop: device matches primary reservation -> MASTER";
          } else {
            secondaryDesktop = devices.has(primaryId);
            masterDecisionReason = "desktop: different device than primary reservation -> CONTROL";
          }
        } else {
          reservedMasterId = getReservedMasterForBranch(userId, branchId);
          if (deviceId === reservedMasterId) {
            mode = "MASTER";
            masterDisconnectedAt.delete(key);
            masterByBranch.set(key, deviceId);
            primaryMasterByBranch.set(key, deviceId);
            persistMasterLease();
            masterDecisionReason = "desktop: reserved master within grace -> MASTER";
          } else if (reservedMasterId) {
            secondaryDesktop = true;
            masterDecisionReason = "desktop: reserved master within grace (other device) -> CONTROL";
          } else {
            mode = "MASTER";
            masterByBranch.set(key, deviceId);
            primaryMasterByBranch.set(key, deviceId);
            persistMasterLease();
            masterDecisionReason = "desktop: no primary/reservation -> first eligible -> MASTER";
          }
        }

        const now = new Date().toISOString();
        devices.set(deviceId, {
          id: deviceId,
          ws,
          connectedAt: now,
          lastSeen: now,
          role: "device",
          mode,
          isMobile,
          userId,
          branchId,
          registrationIntent,
        });
        console.log("[SyncBiz WS] register device", { deviceId, userId, branchId, mode });
        if (process.env.NODE_ENV === "development") {
          console.info("[SyncBiz WS] register device decision", {
            userId,
            branchId,
            deviceId,
            isMobile,
            key,
            primaryId,
            reservedMasterId,
            secondaryDesktop,
            mode,
            reason: masterDecisionReason,
          });
        }
        const sessionCode = getOrCreateSessionCode(userId);
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
      } else if (role === "controller") {
        const regIntent = sanitizeRegistrationIntent(
          (msg as { registrationIntent?: unknown }).registrationIntent
        );
        if (process.env.NODE_ENV === "development" && regIntent) {
          console.info("[SyncBiz WS] register controller intent", regIntent);
        }
        controllers.push({ ws, userId, branchId });
        const sessionCode = getOrCreateSessionCode(userId);
        const reply: ServerMessage = { type: "REGISTERED", sessionCode };
        ws.send(JSON.stringify(reply));
        broadcastDeviceListForUserAndBranch(userId, branchId);
        sendInitialStateToController(ws, userId, branchId);
        console.log("[SyncBiz WS] register controller", { userId, branchId });
      }
      return;
    }

    const msg = parseMessage(data);
    if (!msg) return;

    if (msg.type === "REGISTER") {
      ws.send(JSON.stringify({ type: "ERROR", message: "Already registered" } as ServerMessage));
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
      if (conn) conn.lastSeen = new Date().toISOString();
      const userId = conn?.userId ?? "";
      const branchId = conn?.branchId ?? DEFAULT_BRANCH_ID;
      broadcastStateUpdate(deviceId, msg.state, userId, branchId);
      return;
    }

    if (msg.type === "SET_MASTER" && role === "device" && deviceId) {
      const conn = devices.get(deviceId);
      if (conn) conn.lastSeen = new Date().toISOString();
      const isMobile = conn?.isMobile ?? false;
      const userId = conn?.userId ?? "";
      const branchId = conn?.branchId ?? DEFAULT_BRANCH_ID;
      const key = branchKey(userId, branchId);
      const primaryId = primaryMasterByBranch.get(key);

      if (process.env.NODE_ENV === "development") {
        console.info("[SyncBiz WS] SET_MASTER attempt", {
          userId,
          branchId,
          deviceId,
          isMobile,
          primaryId,
          primaryMatchesDevice: primaryId ? primaryId === deviceId : null,
          masterByBranchCurrent: masterByBranch.get(key) ?? null,
        });
      }

      // Mobile must NEVER become primary branch MASTER. Reject SET_MASTER from mobile.
      if (isMobile) return;

      // Demote ALL other desktop devices in this branch that have mode=MASTER (single source of truth)
      devices.forEach((d) => {
        if (
          d.role === "device" &&
          (d.userId ?? "") === userId &&
          d.branchId === branchId &&
          d.id !== deviceId &&
          d.mode === "MASTER" &&
          !d.isMobile &&
          d.ws.readyState === 1
        ) {
          d.mode = "CONTROL";
          d.ws.send(
            JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL", masterDeviceId: deviceId } as ServerMessage)
          );
        }
      });
      masterByBranch.set(key, deviceId);
      primaryMasterByBranch.set(key, deviceId);
      masterDisconnectedAt.delete(key);
      persistMasterLease();
      if (conn) conn.mode = "MASTER";
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "MASTER" } as ServerMessage));
      }
      broadcastDeviceList();
      return;
    }

    if (msg.type === "SET_CONTROL" && role === "device" && deviceId) {
      const conn = devices.get(deviceId);
      if (conn) conn.lastSeen = new Date().toISOString();
      const userId = conn?.userId ?? "";
      const branchId = conn?.branchId ?? DEFAULT_BRANCH_ID;
      const key = branchKey(userId, branchId);
      const designatedMasterId = masterByBranch.get(key);
      if (designatedMasterId !== deviceId) return;
      masterByBranch.delete(key);
      masterDisconnectedAt.delete(key);
      primaryMasterByBranch.delete(key);
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

  ws.on("close", (code) => {
    clearTimeout(timeout);
    socketLastPongAt.delete(ws);
    const roleLabel = role ?? "unregistered";
    const idLabel = deviceId ?? "-";
    console.log("[SyncBiz WS] disconnect", { role: roleLabel, deviceId: idLabel, code });
    if (deviceId) {
      const conn = devices.get(deviceId);
      if (conn && conn.ws === ws) {
        const userId = conn.userId ?? "";
        const branchId = conn.branchId ?? DEFAULT_BRANCH_ID;
        const key = branchKey(userId, branchId);
        const designatedMasterId = masterByBranch.get(key);
        let shouldTryAutoPromote = false;
        if (designatedMasterId === deviceId) {
          if (conn.isMobile) {
            masterByBranch.delete(key);
            masterDisconnectedAt.delete(key);
            shouldTryAutoPromote = true;
          } else {
            masterDisconnectedAt.set(key, Date.now());
            // Immediate failover only for true-loss close paths.
            // Keep grace reservation for ambiguous/non-loss conditions.
            shouldTryAutoPromote = isTrueMasterLossCloseCode(code);
          }
          persistMasterLease();
        }
        devices.delete(deviceId);
        deviceState.delete(deviceId);
        if (shouldTryAutoPromote && userId) {
          tryPromoteConnectedControlOnMasterLoss(userId, branchId);
        }
      }
    }
    const cIdx = controllers.findIndex((c) => c.ws === ws);
    if (cIdx >= 0) controllers.splice(cIdx, 1);
    const oIdx = owners.findIndex((o) => o.ws === ws);
    if (oIdx >= 0) owners.splice(oIdx, 1);
    broadcastDeviceList();
  });
});

/** Heartbeat: ping connected sockets and close stale ones. */
function runHeartbeat() {
  const now = Date.now();
  const toClose: import("ws").WebSocket[] = [];
  devices.forEach((d) => {
    if (d.ws.readyState === 1) {
      const last = socketLastPongAt.get(d.ws) ?? now;
      if (now - last > HEARTBEAT_PONG_TIMEOUT_MS) {
        console.log("[SyncBiz WS] heartbeat timeout, closing stale device", { deviceId: d.id });
        toClose.push(d.ws);
      } else {
        d.ws.ping();
      }
    }
  });
  controllers.forEach((c) => {
    if (c.ws.readyState === 1) {
      const last = socketLastPongAt.get(c.ws) ?? now;
      if (now - last > HEARTBEAT_PONG_TIMEOUT_MS) {
        console.log("[SyncBiz WS] heartbeat timeout, closing stale controller", { userId: c.userId });
        toClose.push(c.ws);
      } else {
        c.ws.ping();
      }
    }
  });
  owners.forEach((o) => {
    if (o.ws.readyState === 1) {
      const last = socketLastPongAt.get(o.ws) ?? now;
      if (now - last > HEARTBEAT_PONG_TIMEOUT_MS) {
        console.log("[SyncBiz WS] heartbeat timeout, closing stale owner", { userId: o.userId });
        toClose.push(o.ws);
      } else {
        o.ws.ping();
      }
    }
  });
  toClose.forEach((ws) => ws.close(4006, "Heartbeat timeout"));
}
setInterval(runHeartbeat, Math.min(HEARTBEAT_PING_INTERVAL_MS, 15_000));

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[SyncBiz WS] Server listening on 0.0.0.0:${PORT} (MASTER_GRACE_MS=${MASTER_GRACE_MS}, HEARTBEAT=${HEARTBEAT_PING_INTERVAL_MS}ms ping / ${HEARTBEAT_PONG_TIMEOUT_MS}ms timeout)`);
});
