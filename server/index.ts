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
} from "./ws-remote-control-types.js";
import { sanitizeRegistrationIntent, type SyncBizRegistrationIntent } from "./syncbiz-device-model.js";
import { loadLease, saveLease } from "./master-lease-store.js";
import {
  runtimeBranchKey,
  workspaceScopeKey,
  isBranchAllowed,
  ownerReceivesBranch,
  commandTargetInRoom,
} from "./branch-room.js";
import { verifyWsToken } from "./ws-token.js";

const WS_SECRET = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;
if (!WS_SECRET || WS_SECRET.length < 16) {
  console.error("[SyncBiz WS] SYNCBIZ_WS_SECRET or WS_SECRET required (min 16 chars). Exiting.");
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3001;
const REGISTER_TIMEOUT_MS = 5000;

/** Heartbeat: ping interval (ms). Default 30s. */
const HEARTBEAT_PING_INTERVAL_MS = Number(process.env.HEARTBEAT_PING_INTERVAL_MS) || 30_000;
/** Close socket if no pong received within this window (ms). Default 90s. */
const HEARTBEAT_PONG_TIMEOUT_MS = Number(process.env.HEARTBEAT_PONG_TIMEOUT_MS) || 90_000;
/** Presence: lastSeen within this window (ms) = online; older = stale. Default 60s. */
const PRESENCE_ONLINE_THRESHOLD_MS = Number(process.env.PRESENCE_ONLINE_THRESHOLD_MS) || 60_000;

/** Grace period (ms) before another desktop can become MASTER after primary disconnects. Default 90s. */
const MASTER_GRACE_MS = Number(process.env.MASTER_GRACE_MS) || 90_000;

const DEFAULT_BRANCH_ID = "default";

// PR-0: the runtime room key (workspace-scoped) replaces the old `${userId}:${branchId}` key.
// See runtimeBranchKey() / workspaceScopeKey() in ./branch-room.

type DeviceConnection = {
  id: string;
  ws: import("ws").WebSocket;
  connectedAt: string;
  lastSeen: string;
  role: "device" | "controller";
  mode: DeviceMode;
  isMobile?: boolean;
  userId?: string;
  /** Signed workspace scope from the token (PR-0). null for legacy tokens without the claim. */
  workspaceId?: string | null;
  branchId: string;
  /** Runtime branch-room key = workspaceId:branch (or legacy:userId:branch). All room state/routing uses this. */
  roomKey: string;
  /** Sanitized REGISTER hint from client (optional). */
  registrationIntent?: SyncBizRegistrationIntent;
};

const devices = new Map<string, DeviceConnection>();
type ControllerEntry = {
  ws: import("ws").WebSocket;
  userId: string;
  workspaceId?: string | null;
  branchId: string;
  roomKey: string;
};
const controllers: ControllerEntry[] = [];
type OwnerEntry = {
  ws: import("ws").WebSocket;
  userId: string;
  workspaceId?: string | null;
  /** Owner-level workspace scope key (spans branches) for workspace-scoped broadcast fan-out. */
  scopeKey: string;
  authorizedBranches: string[] | null;
};
const owners: OwnerEntry[] = [];

/** Per-socket heartbeat: last pong timestamp. Used to detect stale connections. */
const socketLastPongAt = new Map<import("ws").WebSocket, number>();

/** MASTER device ID per room. Key = runtimeBranchKey (workspace-scoped, or legacy per-user). Persisted to disk. */
const masterByBranch = new Map<string, string>();

/** When the designated MASTER disconnected (timestamp). Key = room key. Persisted to disk. */
const masterDisconnectedAt = new Map<string, number>();

/** Designated primary MASTER per room. Only this device can be MASTER. Persisted to disk. */
const primaryMasterByBranch = new Map<string, string>();

/** Load persisted lease on startup (v2 workspace-scoped; legacy formats are ignored by the store). */
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

/** Returns the currently connected primary MASTER device ID for a room. Desktop-only; null if disconnected, mobile, or grace-expired. */
function getMasterForRoom(key: string): string | null {
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

/** Clear expired grace periods for a room. */
function clearExpiredGracePeriods(key: string) {
  const disconnectedAt = masterDisconnectedAt.get(key);
  if (!disconnectedAt) return;
  if (Date.now() - disconnectedAt > MASTER_GRACE_MS) {
    masterByBranch.delete(key);
    masterDisconnectedAt.delete(key);
    primaryMasterByBranch.delete(key);
    persistMasterLease();
  }
}

function isEligibleConnectedPlaybackCandidate(d: DeviceConnection, roomKey: string): boolean {
  if (d.role !== "device") return false;
  if (d.roomKey !== roomKey) return false;
  if (d.ws.readyState !== 1) return false;
  if (d.isMobile) return false;
  const intent = d.registrationIntent;
  if (!intent) return true;
  return (
    intent.runtimeMode === "branch_playback" &&
    (intent.devicePurpose === "branch_desktop_station" ||
      intent.devicePurpose === "branch_streamer_station" ||
      intent.devicePurpose === "branch_web_station")
  );
}

/**
 * Branch MASTER priority (deterministic):
 *   1. branch_streamer_station — preferred dedicated branch MASTER
 *   2. branch_desktop_station — fallback MASTER when no active/reserved streamer
 *   3. branch_web_station — cold-start fallback only
 *   4. mobile — never MASTER
 */
function isStreamerStation(d: DeviceConnection | null | undefined): boolean {
  return d?.registrationIntent?.devicePurpose === "branch_streamer_station";
}

function isDesktopOnlyStation(d: DeviceConnection | null | undefined): boolean {
  return d?.registrationIntent?.devicePurpose === "branch_desktop_station";
}

function isDedicatedPlayerStation(d: DeviceConnection | null | undefined): boolean {
  return isStreamerStation(d) || isDesktopOnlyStation(d);
}

/** Connected streamer actively holding MASTER for this room. */
function getActiveStreamerMaster(key: string): DeviceConnection | null {
  const masterId = masterByBranch.get(key);
  if (!masterId) return null;
  const conn = devices.get(masterId);
  if (!conn || conn.ws.readyState !== 1 || conn.mode !== "MASTER" || conn.isMobile) return null;
  return isStreamerStation(conn) ? conn : null;
}

/** Primary device id still reserved within disconnect grace (blocks fallback desktop MASTER). */
function primaryReservedInGrace(key: string): string | null {
  const primaryId = primaryMasterByBranch.get(key);
  if (!primaryId) return null;
  if (devices.get(primaryId)?.ws.readyState === 1) return null;
  const disconnectedAt = masterDisconnectedAt.get(key);
  if (!disconnectedAt) return null;
  if (Date.now() - disconnectedAt > MASTER_GRACE_MS) return null;
  return primaryId;
}

/** True when streamer priority blocks desktop/web from claiming MASTER. */
function streamerBlocksFallbackMaster(key: string, requesterDeviceId: string): boolean {
  if (getActiveStreamerMaster(key)) return true;
  const reserved = primaryReservedInGrace(key);
  return !!reserved && reserved !== requesterDeviceId;
}

/** Always-on, structured lease-transition log so MASTER changes are visible in production stdout. */
function logLeaseEvent(event: string, data: Record<string, unknown>): void {
  console.log(`[SyncBiz WS][lease] ${event}`, JSON.stringify(data));
}

function demoteOtherMasters(roomKey: string, exceptDeviceId: string, newMasterId: string): void {
  devices.forEach((d) => {
    if (d.id === exceptDeviceId) return;
    if (!isEligibleConnectedPlaybackCandidate(d, roomKey)) return;
    if (d.mode !== "MASTER") return;
    d.mode = "CONTROL";
    d.ws.send(
      JSON.stringify({ type: "SET_DEVICE_MODE", mode: "CONTROL", masterDeviceId: newMasterId } as ServerMessage)
    );
  });
}

function tryPromoteConnectedControlOnMasterLoss(roomKey: string): string | null {
  // Streamer priority: prefer streamer CONTROL, then desktop CONTROL, then web fallback.
  let streamerCandidate: DeviceConnection | null = null;
  let desktopCandidate: DeviceConnection | null = null;
  let webCandidate: DeviceConnection | null = null;
  devices.forEach((d) => {
    if (!isEligibleConnectedPlaybackCandidate(d, roomKey)) return;
    if (d.mode !== "CONTROL") return;
    if (isStreamerStation(d)) {
      if (!streamerCandidate || d.connectedAt < streamerCandidate.connectedAt) {
        streamerCandidate = d;
      }
    } else if (isDesktopOnlyStation(d)) {
      if (!desktopCandidate || d.connectedAt < desktopCandidate.connectedAt) {
        desktopCandidate = d;
      }
    } else {
      if (!webCandidate || d.connectedAt < webCandidate.connectedAt) {
        webCandidate = d;
      }
    }
  });
  const pick = streamerCandidate ?? desktopCandidate ?? webCandidate;
  if (!pick) return null;
  const selected: DeviceConnection = pick as DeviceConnection;

  const key = roomKey;
  devices.forEach((d) => {
    if (
      d.role === "device" &&
      d.roomKey === roomKey &&
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
  // primaryMasterByBranch policy:
  //   - If an existing primary is reserved (device in grace period), leave it so the
  //     original device can reclaim MASTER when it reconnects within the grace window.
  //   - If no primary is reserved, set it to the newly promoted device (regardless of
  //     type) so the promoted MASTER gets grace-period protection on its next disconnect.
  //     Previously this only applied to dedicated (desktop/streamer) stations; now web
  //     stations promoted via auto-elect also gain the protection.
  if (!primaryMasterByBranch.has(key)) {
    primaryMasterByBranch.set(key, selected.id);
  }
  masterDisconnectedAt.delete(key);
  persistMasterLease();
  if (selected.ws.readyState === 1) {
    selected.ws.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "MASTER" } as ServerMessage));
  }
  logLeaseEvent("promote", {
    roomKey,
    deviceId: selected.id,
    purpose: selected.registrationIntent?.devicePurpose ?? "unknown",
    triggeredBy: "tryPromoteConnectedControlOnMasterLoss",
    primaryAfter: primaryMasterByBranch.get(key) ?? null,
  });
  return selected.id;
}

function isTrueMasterLossCloseCode(code: number): boolean {
  // Only *unambiguous* master-loss codes trigger immediate takeover promotion:
  //   1001 = Going Away (tab/app closed explicitly, user intent clear).
  //   4006 = Heartbeat timeout (90s of silence — master is truly gone).
  // All other codes (1000 clean close from transient reload/navigation, 1005 no
  // status, 1006 abnormal loss on network blip) are ambiguous and the master
  // may return momentarily. Those fall back to the normal grace window and
  // avoid the "master ping-pong" between desktop and browser on every blip.
  return code === 1001 || code === 4006;
}

/**
 * Playing-master hard lock.
 *
 * Returns the MASTER device ID if ALL of the following are true:
 *   1. There is a current MASTER recorded in masterByBranch for this branch.
 *   2. That MASTER's WebSocket is open (readyState === 1 — device is live).
 *   3. Its last-reported playback state is "playing".
 *   4. The device requesting the check is NOT the current MASTER itself
 *      (so a reconnecting MASTER never blocks its own reclaim).
 *
 * When this returns a non-null value, NO other device may claim MASTER.
 * Pass `requesterDeviceId` so the MASTER device's own reconnect is exempt.
 */
function getMasterPlayingLockId(key: string, requesterDeviceId: string): string | null {
  const masterId = masterByBranch.get(key);
  if (!masterId || masterId === requesterDeviceId) return null;
  const masterConn = devices.get(masterId);
  if (!masterConn || masterConn.ws.readyState !== 1) return null;
  const state = deviceState.get(masterId);
  return state?.status === "playing" ? masterId : null;
}

function broadcastLibraryUpdated(
  userId: string,
  branchId: string,
  entityType?: "playlist" | "source" | "radio",
  action?: "created" | "updated" | "deleted",
  entityId?: string,
) {
  const msg: ServerMessage = { type: "LIBRARY_UPDATED", branchId, entityType, action, entityId };
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

/** DEVICE_LIST for one workspace room. Roster + masterDeviceId are room-scoped; the guest sessionCode stays
 *  per authenticated recipient (guest pairing remains user-scoped), so each recipient gets its own code. */
function broadcastDeviceListForRoom(roomKey: string) {
  const now = Date.now();
  const list: DeviceInfo[] = [];
  devices.forEach((d) => {
    if (d.role === "device" && d.roomKey === roomKey) {
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
  const masterDeviceId = getMasterForRoom(roomKey);
  const sendTo = (target: { ws: import("ws").WebSocket; userId?: string }) => {
    if (target.ws.readyState !== 1) return;
    const sessionCode = target.userId ? getOrCreateSessionCode(target.userId) : undefined;
    target.ws.send(JSON.stringify({ type: "DEVICE_LIST", devices: list, masterDeviceId, sessionCode } as ServerMessage));
  };
  controllers.forEach((c) => { if (c.roomKey === roomKey) sendTo(c); });
  devices.forEach((d) => { if (d.role === "device" && d.roomKey === roomKey) sendTo(d); });
}

function broadcastDeviceList() {
  const rooms = new Set<string>();
  controllers.forEach((c) => rooms.add(c.roomKey));
  devices.forEach((d) => { if (d.role === "device") rooms.add(d.roomKey); });
  rooms.forEach((roomKey) => broadcastDeviceListForRoom(roomKey));
}

function broadcastStateUpdate(
  deviceId: string,
  state: StationPlaybackState,
  roomKey: string,
  scopeKey: string,
  branchId: string,
) {
  deviceState.set(deviceId, state);
  const msg: ServerMessage = { type: "STATE_UPDATE", deviceId, state };
  const raw = JSON.stringify(msg);
  controllers.forEach((c) => {
    if (c.roomKey === roomKey && c.ws.readyState === 1) c.ws.send(raw);
  });
  devices.forEach((d) => {
    if (d.role === "device" && d.roomKey === roomKey && d.id !== deviceId && d.ws.readyState === 1) {
      d.ws.send(raw);
    }
  });
  // Owner fan-out requires workspace scope AND per-user branch authorization (owner role is client-supplied).
  owners.forEach((o) => {
    if (o.ws.readyState === 1 && ownerReceivesBranch(o, { scopeKey, branchId })) o.ws.send(raw);
  });
}

function sendInitialStateToController(ws: import("ws").WebSocket, roomKey: string) {
  devices.forEach((d) => {
    if (d.role === "device" && d.roomKey === roomKey) {
      const state = deviceState.get(d.id);
      if (state) {
        const msg: ServerMessage = { type: "STATE_UPDATE", deviceId: d.id, state };
        if (ws.readyState === 1) ws.send(JSON.stringify(msg));
      }
    }
  });
}

/** Build branch list for an owner: branches with a connected MASTER device in the owner's WORKSPACE scope. */
function getBranchListForOwner(owner: OwnerEntry): BranchSummary[] {
  const branches: BranchSummary[] = [];
  const seen = new Set<string>();
  devices.forEach((conn) => {
    if (conn.role !== "device" || conn.mode !== "MASTER" || conn.isMobile) return;
    if (conn.ws.readyState !== 1) return;
    // Workspace scope AND per-user branch authorization (scope alone is not sufficient).
    if (!ownerReceivesBranch(owner, { scopeKey: workspaceScopeKey(conn.workspaceId, conn.userId), branchId: conn.branchId })) return;
    const branchId = conn.branchId;
    if (seen.has(branchId)) return;
    seen.add(branchId);
    let deviceCount = 0;
    devices.forEach((d) => {
      if (d.role === "device" && d.roomKey === conn.roomKey) deviceCount++;
    });
    branches.push({
      branchId,
      masterDeviceId: conn.id,
      connectedAt: conn.connectedAt,
      hasDevices: deviceCount > 0,
    });
  });
  return branches;
}

function sendBranchListToOwner(ws: import("ws").WebSocket, owner: OwnerEntry) {
  const branches = getBranchListForOwner(owner);
  const msg: ServerMessage = { type: "BRANCH_LIST", branches };
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/**
 * Phase 1 branch authorization: a REGISTER/target branchId is allowed only if it is in the token's
 * authoritative `authorizedBranches` claim (minted from DB authorization by the app layer). A legacy
 * token (claim === null) is restricted to the default branch only — a missing claim is NEVER treated
 * as "all branches".
 */
// isBranchAllowed is imported from ./branch-room (canonical, pure, unit-tested).

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
  // Branch authorization is deferred to after token verification (needs the token's branch claim).
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
        const data = body
          ? (JSON.parse(body) as {
              userId?: string;
              branchId?: string;
              entityType?: "playlist" | "source" | "radio";
              action?: "created" | "updated" | "deleted";
              entityId?: string;
            })
          : {};
        const userId = typeof data.userId === "string" ? data.userId.trim() : "";
        const branchId = (typeof data.branchId === "string" ? data.branchId.trim() : "") || DEFAULT_BRANCH_ID;
        const entityId = typeof data.entityId === "string" ? data.entityId.trim() : undefined;
        if (userId) {
          broadcastLibraryUpdated(userId, branchId, data.entityType, data.action, entityId);
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
      const auth = verifyWsToken(validation.authToken);
      if (!auth) {
        clearTimeout(timeout);
        ws.send(JSON.stringify({ type: "ERROR", message: "Invalid or expired token" } as ServerMessage));
        ws.close(4005, "Invalid token");
        return;
      }
      const userId = auth.userId;
      const authorizedBranches = auth.authorizedBranches;
      registered = true;
      clearTimeout(timeout);
      role = validation.role as "device" | "controller" | "owner_global";
      const branchId = validation.branchId;

      // Phase 1 branch authorization: the requested REGISTER branch must be in the token's claim.
      // owner_global carries no register branch (it targets a branch per-COMMAND), so it is
      // validated in the COMMAND handler instead.
      if (role !== "owner_global" && !isBranchAllowed(branchId, authorizedBranches)) {
        ws.send(JSON.stringify({ type: "ERROR", message: "Branch not authorized" } as ServerMessage));
        ws.close(4004, "Branch not authorized");
        return;
      }

      // PR-0: workspace scope comes ONLY from the signed token (never the REGISTER body). Room = workspace+branch.
      const workspaceId = auth.workspaceId ?? null;
      const scopeKey = workspaceScopeKey(workspaceId, userId);
      if (!workspaceId) {
        console.warn(
          "[SyncBiz WS][scope] legacy token without signed workspaceId — using per-user fallback room",
          JSON.stringify({ userId, branchId, role }),
        );
      }

      if (role === "owner_global") {
        const regIntent = sanitizeRegistrationIntent(
          (msg as { registrationIntent?: unknown }).registrationIntent
        );
        if (process.env.NODE_ENV === "development" && regIntent) {
          console.info("[SyncBiz WS] register owner_global intent", regIntent);
        }
        const ownerEntry: OwnerEntry = { ws, userId, workspaceId, scopeKey, authorizedBranches };
        owners.push(ownerEntry);
        ws.send(JSON.stringify({ type: "REGISTERED" } as ServerMessage));
        sendBranchListToOwner(ws, ownerEntry);
        console.log("[SyncBiz WS] register owner", { userId });
        return;
      }

      if (role === "device" && validation.deviceId) {
        deviceId = validation.deviceId;
        const isMobile = (msg as { isMobile?: boolean }).isMobile ?? false;
        const registrationIntent = sanitizeRegistrationIntent(
          (msg as { registrationIntent?: unknown }).registrationIntent
        );

        const roomKey = runtimeBranchKey(workspaceId, userId, branchId);
        clearExpiredGracePeriods(roomKey);
        let mode: DeviceMode = "CONTROL";
        let secondaryDesktop = false;
        const key = roomKey;
        const primaryId = primaryMasterByBranch.get(key);
        let masterDecisionReason = "";

        const purpose = registrationIntent?.devicePurpose;
        const isStreamerReg = purpose === "branch_streamer_station";
        const isDesktopReg = purpose === "branch_desktop_station";
        const primaryConn = primaryId ? devices.get(primaryId) : undefined;
        const activeStreamerMaster = getActiveStreamerMaster(roomKey);

        // ── Playing-master hard lock ─────────────────────────────────────────────
        // Evaluated before ALL other MASTER/CONTROL decisions so it gates every path.
        // Streamers are exempt: they hold the highest MASTER priority and may displace
        // any lower-priority playing MASTER (web/desktop station).
        // Mobile is also exempt: it can never become MASTER anyway.
        const playingLockId = (isMobile || isStreamerReg)
          ? null
          : getMasterPlayingLockId(key, deviceId);

        if (isMobile) {
          // Mobile must never own primary. Clean up any stale ownership.
          if (masterByBranch.get(key) === deviceId) {
            masterByBranch.delete(key);
            masterDisconnectedAt.delete(key);
            if (primaryMasterByBranch.get(key) === deviceId) primaryMasterByBranch.delete(key);
            persistMasterLease();
          }
          masterDecisionReason = "mobile: never claim primary MASTER lease";
        } else if (playingLockId) {
          // Hard lock: the live MASTER is actively playing audio.
          // Force CONTROL regardless of this device's type or priority.
          // The business player keeps its MASTER lease uninterrupted.
          mode = "CONTROL";
          if (isDesktopReg || isStreamerReg) secondaryDesktop = true;
          masterDecisionReason = `MASTER_LOCKED_PLAYING: master ${playingLockId} is actively playing — forced CONTROL`;
          // Emit a dedicated denial event so it is easy to spot in production logs.
          logLeaseEvent("register_denied_playing_lock", {
            userId,
            branchId,
            deviceId,
            requesterPurpose: purpose ?? "unknown",
            lockedByMasterId: playingLockId,
            lockedByPurpose: devices.get(playingLockId)?.registrationIntent?.devicePurpose ?? "unknown",
            masterPlayState: deviceState.get(playingLockId)?.status ?? "unknown",
            reason: "MASTER_LOCKED_PLAYING",
            triggeredBy: "REGISTER",
          });
        } else if (deviceId === primaryId) {
          if (isDesktopReg && activeStreamerMaster) {
            secondaryDesktop = true;
            masterDecisionReason = "desktop primary reclaim blocked: streamer active MASTER -> CONTROL";
          } else {
            mode = "MASTER";
            masterDisconnectedAt.delete(key);
            demoteOtherMasters(key, deviceId, deviceId);
            masterByBranch.set(key, deviceId);
            primaryMasterByBranch.set(key, deviceId);
            persistMasterLease();
            masterDecisionReason = isStreamerReg
              ? "streamer primary reclaim -> MASTER"
              : isDesktopReg
                ? "desktop primary reclaim -> MASTER"
                : "primary reclaim -> MASTER";
          }
        } else if (isStreamerReg) {
          if (activeStreamerMaster && activeStreamerMaster.id !== deviceId) {
            secondaryDesktop = true;
            masterDecisionReason = "another streamer already MASTER -> CONTROL";
          } else {
            mode = "MASTER";
            masterDisconnectedAt.delete(key);
            demoteOtherMasters(key, deviceId, deviceId);
            masterByBranch.set(key, deviceId);
            primaryMasterByBranch.set(key, deviceId);
            persistMasterLease();
            masterDecisionReason = "streamer priority -> MASTER (demoted fallback holders)";
          }
        } else if (isDesktopReg) {
          if (streamerBlocksFallbackMaster(key, deviceId)) {
            secondaryDesktop = true;
            masterDecisionReason = activeStreamerMaster
              ? "streamer active MASTER -> desktop CONTROL"
              : "streamer primary reserved in grace -> desktop CONTROL";
          } else if (
            primaryConn &&
            primaryConn.ws.readyState === 1 &&
            isDesktopOnlyStation(primaryConn) &&
            primaryConn.id !== deviceId
          ) {
            secondaryDesktop = true;
            masterDecisionReason = "another desktop holds primary -> CONTROL (secondary)";
          } else {
            mode = "MASTER";
            masterDisconnectedAt.delete(key);
            demoteOtherMasters(key, deviceId, deviceId);
            masterByBranch.set(key, deviceId);
            primaryMasterByBranch.set(key, deviceId);
            persistMasterLease();
            masterDecisionReason = "desktop fallback: no active streamer -> MASTER";
          }
        } else {
          // Web station: fallback only when streamer and desktop are not blocking.
          if (streamerBlocksFallbackMaster(key, deviceId)) {
            masterDecisionReason = activeStreamerMaster
              ? "streamer active MASTER -> web CONTROL"
              : "streamer primary reserved in grace -> web CONTROL";
          } else if (
            primaryConn &&
            primaryConn.ws.readyState === 1 &&
            isDedicatedPlayerStation(primaryConn)
          ) {
            masterDecisionReason = "dedicated player holds/reserves primary -> web CONTROL";
          } else {
            const currentMasterId = masterByBranch.get(key);
            const currentMaster =
              currentMasterId && currentMasterId !== deviceId ? devices.get(currentMasterId) : undefined;
            const someoneElseAlreadyMaster =
              !!currentMaster && currentMaster.ws.readyState === 1 && currentMaster.mode === "MASTER";
            if (someoneElseAlreadyMaster) {
              masterDecisionReason = "existing MASTER present (no steal) -> web CONTROL";
            } else {
              mode = "MASTER";
              masterDisconnectedAt.delete(key);
              masterByBranch.set(key, deviceId);
              // Set primary so web station MASTER gets grace-period protection on disconnect.
              // Without this, any brief WS interruption (e.g. during a track transition)
              // would open the lease to the first reconnecting device — the root cause of
              // the "music stops when second computer logs in" production bug.
              primaryMasterByBranch.set(key, deviceId);
              persistMasterLease();
              masterDecisionReason = "web fallback: no streamer/desktop MASTER -> MASTER (primary reserved)";
            }
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
          workspaceId,
          branchId,
          roomKey,
          registrationIntent,
        });
        console.log("[SyncBiz WS] register device", { deviceId, userId, branchId, mode });
        logLeaseEvent("register", {
          userId,
          branchId,
          deviceId,
          isMobile,
          purpose: registrationIntent?.devicePurpose ?? "unknown",
          primaryBefore: primaryId ?? null,
          primaryAfter: primaryMasterByBranch.get(key) ?? null,
          masterAfter: masterByBranch.get(key) ?? null,
          secondaryDesktop,
          mode,
          reason: masterDecisionReason,
          triggeredBy: "REGISTER",
        });
        const sessionCode = getOrCreateSessionCode(userId);
        const reply: ServerMessage = { type: "REGISTERED", deviceId, sessionCode };
        ws.send(JSON.stringify(reply));
        const masterDeviceIdForClient = getMasterForRoom(roomKey);
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
        const roomKey = runtimeBranchKey(workspaceId, userId, branchId);
        controllers.push({ ws, userId, workspaceId, branchId, roomKey });
        const sessionCode = getOrCreateSessionCode(userId);
        const reply: ServerMessage = { type: "REGISTERED", sessionCode };
        ws.send(JSON.stringify(reply));
        broadcastDeviceListForRoom(roomKey);
        sendInitialStateToController(ws, roomKey);
        console.log("[SyncBiz WS] register controller", { userId, branchId, roomKey });
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
      if (owner) sendBranchListToOwner(ws, owner);
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
      const senderCtrl = controllers.find((c) => c.ws === ws);
      const senderUserId = conn?.userId ?? (senderCtrl?.userId ?? "");
      if (senderUserId !== userId) return;
      // Route the approved play to the APPROVER'S room master (guest pairing stays user-scoped for identity).
      const approverRoomKey = conn?.roomKey ?? senderCtrl?.roomKey ?? null;
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
        const masterId = approverRoomKey ? getMasterForRoom(approverRoomKey) : null;
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
      const roomKey = conn?.roomKey ?? runtimeBranchKey(conn?.workspaceId, userId, branchId);
      const scopeKey = workspaceScopeKey(conn?.workspaceId, userId);
      broadcastStateUpdate(deviceId, msg.state, roomKey, scopeKey, branchId);
      return;
    }

    if (msg.type === "SET_MASTER" && role === "device" && deviceId) {
      const conn = devices.get(deviceId);
      if (conn) conn.lastSeen = new Date().toISOString();
      const isMobile = conn?.isMobile ?? false;
      const userId = conn?.userId ?? "";
      const branchId = conn?.branchId ?? DEFAULT_BRANCH_ID;
      const key = conn?.roomKey ?? runtimeBranchKey(conn?.workspaceId, userId, branchId);
      const primaryId = primaryMasterByBranch.get(key);
      const requesterIsStreamer = isStreamerStation(conn);
      const requesterIsDesktop = isDesktopOnlyStation(conn);
      const requesterIsDedicated = isDedicatedPlayerStation(conn);

      // Mobile must NEVER become primary branch MASTER. Reject SET_MASTER from mobile.
      if (isMobile) {
        logLeaseEvent("set_master_blocked", {
          userId,
          branchId,
          deviceId,
          reason: "mobile",
          triggeredBy: "SET_MASTER",
        });
        return;
      }

      // ── Playing-master hard lock ─────────────────────────────────────────────
      // Streamers are exempt (highest MASTER priority). For all other device types,
      // reject SET_MASTER if the live MASTER is actively playing audio.
      if (!requesterIsStreamer) {
        const liveMasterIdLock = masterByBranch.get(key);
        if (liveMasterIdLock && liveMasterIdLock !== deviceId) {
          const liveMasterConnLock = devices.get(liveMasterIdLock);
          if (liveMasterConnLock?.ws.readyState === 1) {
            const liveMasterStateLock = deviceState.get(liveMasterIdLock);
            if (liveMasterStateLock?.status === "playing") {
              logLeaseEvent("set_master_denied_playing_lock", {
                userId,
                branchId,
                deviceId: deviceId!,
                requesterPurpose: conn?.registrationIntent?.devicePurpose ?? "unknown",
                lockedByMasterId: liveMasterIdLock,
                lockedByPurpose: liveMasterConnLock.registrationIntent?.devicePurpose ?? "unknown",
                masterPlayState: liveMasterStateLock.status,
                oldMasterPlaying: true,
                reason: "MASTER_LOCKED_PLAYING",
                triggeredBy: "SET_MASTER",
              });
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "ERROR", message: "MASTER_LOCKED_PLAYING" } as ServerMessage));
              }
              return;
            }
          }
        }
      }

      // Streamer priority: desktop/web cannot take MASTER while streamer holds priority.
      if (requesterIsDesktop && streamerBlocksFallbackMaster(key, deviceId)) {
        logLeaseEvent("set_master_blocked", {
          userId,
          branchId,
          deviceId,
          purpose: conn?.registrationIntent?.devicePurpose ?? "unknown",
          reason: getActiveStreamerMaster(key)
            ? "desktop SET_MASTER blocked: streamer active MASTER"
            : "desktop SET_MASTER blocked: streamer primary reserved in grace",
          triggeredBy: "SET_MASTER",
        });
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "ERROR", message: "Streamer has branch audio priority" } as ServerMessage));
        }
        return;
      }

      const currentMasterId = masterByBranch.get(key);
      const currentMaster =
        currentMasterId && currentMasterId !== deviceId ? devices.get(currentMasterId) : undefined;
      const dedicatedActiveMaster =
        !!currentMaster &&
        currentMaster.ws.readyState === 1 &&
        currentMaster.mode === "MASTER" &&
        isDedicatedPlayerStation(currentMaster);
      if (!requesterIsDedicated && dedicatedActiveMaster) {
        logLeaseEvent("set_master_blocked", {
          userId,
          branchId,
          deviceId,
          purpose: conn?.registrationIntent?.devicePurpose ?? "unknown",
          reason: "non-dedicated SET_MASTER blocked by active dedicated MASTER",
          activeDedicatedMasterId: currentMaster.id,
          triggeredBy: "SET_MASTER",
        });
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "ERROR", message: "Dedicated player is currently MASTER" } as ServerMessage));
        }
        return;
      }

      const oldMasterIdForLog = masterByBranch.get(key);
      const oldMasterConnForLog = oldMasterIdForLog && oldMasterIdForLog !== deviceId
        ? devices.get(oldMasterIdForLog) : undefined;
      const oldMasterWasPlaying = oldMasterIdForLog
        ? (deviceState.get(oldMasterIdForLog)?.status === "playing") : false;

      demoteOtherMasters(key, deviceId, deviceId);
      masterByBranch.set(key, deviceId);
      // Always set primary so every explicitly-claimed MASTER gets grace-period protection
      // on its next disconnect — prevents any brief WS interruption from opening the lease.
      primaryMasterByBranch.set(key, deviceId);
      masterDisconnectedAt.delete(key);
      persistMasterLease();
      if (conn) conn.mode = "MASTER";
      logLeaseEvent("set_master", {
        userId,
        branchId,
        deviceId: deviceId!,
        purpose: conn?.registrationIntent?.devicePurpose ?? "unknown",
        oldMasterId: oldMasterIdForLog ?? null,
        oldMasterPurpose: oldMasterConnForLog?.registrationIntent?.devicePurpose ?? null,
        oldMasterWasPlaying,
        primaryBefore: primaryId ?? null,
        primaryAfter: primaryMasterByBranch.get(key) ?? null,
        triggeredBy: "SET_MASTER",
      });
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
      const key = conn?.roomKey ?? runtimeBranchKey(conn?.workspaceId, userId, branchId);
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
      logLeaseEvent("set_control", {
        userId,
        branchId,
        deviceId,
        purpose: conn?.registrationIntent?.devicePurpose ?? "unknown",
        triggeredBy: "SET_CONTROL",
      });
      broadcastDeviceList();
      return;
    }

    if (msg.type === "COMMAND") {
      let masterId: string | null = null;
      // The command may ONLY reach a MASTER in this exact room (workspace+branch) — never cross rooms.
      let expectedRoomKey: string | null = null;
      if (role === "owner_global") {
        const owner = owners.find((o) => o.ws === ws);
        const targetBranchId = (msg.targetBranchId ?? "").trim() || DEFAULT_BRANCH_ID;
        // Phase 1: an owner may only target a branch present in its token claim.
        if (!owner || !isBranchAllowed(targetBranchId, owner.authorizedBranches)) {
          ws.send(JSON.stringify({ type: "ERROR", message: "Branch not authorized" } as ServerMessage));
          return;
        }
        // Target the workspace room for (owner workspace, targetBranch).
        expectedRoomKey = runtimeBranchKey(owner.workspaceId, owner.userId, targetBranchId);
        masterId = getMasterForRoom(expectedRoomKey);
      } else {
        expectedRoomKey =
          (role === "controller"
            ? controllers.find((c) => c.ws === ws)?.roomKey
            : devices.get(deviceId!)?.roomKey) ?? null;
        // Prefer the current room MASTER; a targetDeviceId fallback is honored ONLY if it is in the SAME room.
        masterId = (expectedRoomKey ? getMasterForRoom(expectedRoomKey) : null) ?? msg.targetDeviceId ?? null;
      }
      const target = masterId ? devices.get(masterId) : null;
      // Room-isolation guard: target must be a MASTER whose room === expectedRoomKey (blocks cross-room
      // targetDeviceId escape). expectedRoomKey null (no room) → rejected.
      if (!expectedRoomKey || !commandTargetInRoom(expectedRoomKey, target)) {
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
        (role === "device" && deviceId && target!.id === masterId);
      if (canSend && target!.ws.readyState === 1) {
        target!.ws.send(JSON.stringify(cmd));
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
        const key = conn.roomKey ?? runtimeBranchKey(conn.workspaceId, userId, branchId);
        const designatedMasterId = masterByBranch.get(key);
        let shouldTryAutoPromote = false;
        let masterDeathReason = "";
        if (designatedMasterId === deviceId) {
          if (conn.isMobile) {
            // Mobile should never have been MASTER; clean up unconditionally.
            masterByBranch.delete(key);
            masterDisconnectedAt.delete(key);
            shouldTryAutoPromote = true;
            masterDeathReason = "mobile MASTER cleanup";
          } else if (isDedicatedPlayerStation(conn)) {
            // Dedicated primary (streamer or desktop): keep grace window so a brief reconnect reclaims MASTER.
            // Fallback desktop must NOT auto-promote during streamer grace; only another dedicated CONTROL may
            // take over immediately on a true-loss close (streamer CONTROL preferred in tryPromote).
            masterDisconnectedAt.set(key, Date.now());
            if (isTrueMasterLossCloseCode(code)) {
              let hasOtherDedicatedControl = false;
              for (const d of devices.values()) {
                if (d.id === deviceId) continue;
                if (!isEligibleConnectedPlaybackCandidate(d, key)) continue;
                if (d.mode !== "CONTROL") continue;
                if (isDedicatedPlayerStation(d)) {
                  hasOtherDedicatedControl = true;
                  break;
                }
              }
              shouldTryAutoPromote = hasOtherDedicatedControl;
              masterDeathReason = hasOtherDedicatedControl
                ? "dedicated MASTER true-loss with dedicated CONTROL available -> promote"
                : "dedicated MASTER true-loss, no dedicated CONTROL -> grace window";
            } else {
              masterDeathReason = "dedicated MASTER ambiguous close -> grace window";
            }
          } else {
            // Web/fallback MASTER: use the same grace-period model as dedicated stations.
            //
            // Ambiguous close (network blip, code 1005/1006 etc.): keep the lease reserved
            // within the grace window so the device can reconnect and reclaim without any
            // other device stealing MASTER.  This prevents the "track end / second login
            // steals MASTER" production bug where a brief WS drop wiped the lease.
            //
            // True-loss close (tab closed = 1001, heartbeat timeout = 4006): release the
            // primary reservation and drop the lease immediately so another CONTROL can
            // take over without waiting the full grace period.
            masterDisconnectedAt.set(key, Date.now());
            if (isTrueMasterLossCloseCode(code)) {
              // Voluntary / confirmed departure: release lease so branch isn't silently stalled.
              masterByBranch.delete(key);
              if (primaryMasterByBranch.get(key) === deviceId) {
                primaryMasterByBranch.delete(key);
              }
              shouldTryAutoPromote = true;
              masterDeathReason = "web MASTER true-loss -> primary released, auto-promote if CONTROL available";
            } else {
              // Network blip: keep lease and primary so device can reclaim within grace.
              masterDeathReason = "web MASTER ambiguous close -> grace window (lease + primary preserved)";
              // There is no periodic sweeper: clearExpiredGracePeriods only runs inside REGISTER and
              // tryPromote only on true-loss close. So if an already-connected CONTROL exists and no
              // new REGISTER arrives, the expired grace would never be swept and the branch would stay
              // leased to the gone web MASTER indefinitely. Schedule a one-shot, guarded sweep.
              const sweepKey = key;
              const sweepUserId = userId;
              const sweepBranchId = branchId;
              const graceSweep = setTimeout(() => {
                const disconnectedAt = masterDisconnectedAt.get(sweepKey);
                // Reconnected (REGISTER clears the timestamp) or a newer disconnect reset the clock.
                if (!disconnectedAt || Date.now() - disconnectedAt <= MASTER_GRACE_MS) return;
                // Reserved master came back and is live -> leave it be.
                const reservedId = masterByBranch.get(sweepKey);
                const reservedConn = reservedId ? devices.get(reservedId) : undefined;
                if (reservedConn && reservedConn.ws.readyState === 1) return;
                clearExpiredGracePeriods(sweepKey);
                const promoted = tryPromoteConnectedControlOnMasterLoss(sweepKey);
                if (promoted) {
                  logLeaseEvent("grace_sweep_promote", {
                    userId: sweepUserId,
                    branchId: sweepBranchId,
                    deviceId: promoted,
                    triggeredBy: "web_master_grace_sweep",
                  });
                  broadcastDeviceList();
                }
              }, MASTER_GRACE_MS + 1000);
              // Never keep the process alive just for this sweep.
              if (typeof graceSweep.unref === "function") graceSweep.unref();
            }
          }
          persistMasterLease();
          logLeaseEvent("master_death", {
            userId,
            branchId,
            deviceId,
            purpose: conn.registrationIntent?.devicePurpose ?? "unknown",
            isMobile: conn.isMobile === true,
            closeCode: code,
            shouldTryAutoPromote,
            primaryAfter: primaryMasterByBranch.get(key) ?? null,
            masterAfter: masterByBranch.get(key) ?? null,
            triggeredBy: "ws_close",
            reason: masterDeathReason,
          });
        }
        devices.delete(deviceId);
        deviceState.delete(deviceId);
        if (shouldTryAutoPromote && userId) {
          tryPromoteConnectedControlOnMasterLoss(key);
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
