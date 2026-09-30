/**
 * PR-0 regression — workspace-scoped WS branch room.
 *
 * Tests the pure room-key invariant (two users in the same workspace+branch share ONE room; same branchId in
 * different workspaces is isolated; legacy null-workspace falls back to an explicit per-user key, never a
 * "null:branch" room), the versioned lease store (legacy userId-scoped files are ignored, not misread), and
 * static guards that server/index.ts routes by roomKey, consumes the SIGNED workspaceId (never the REGISTER
 * body), and never imports Prisma.
 *
 * Run: npx tsx server/verify-branch-room.ts
 */
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runtimeBranchKey,
  workspaceScopeKey,
  isLegacyRoomKey,
  isBranchAllowed,
  ownerReceivesBranch,
  commandTargetInRoom,
} from "./branch-room.js";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const here = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  // ── Pure room-key invariant ─────────────────────────────────────────────────────────────────────────────
  {
    const a = runtimeBranchKey("ws-1", "userA", "default");
    const b = runtimeBranchKey("ws-1", "userB", "default"); // different user, SAME workspace+branch
    assert("two users, same workspace+branch → SAME room key", a === b, `${a} vs ${b}`);
    assert("room key is workspace-scoped form", a === "ws:ws-1:default");
  }
  {
    const wsA = runtimeBranchKey("ws-A", "u", "default");
    const wsB = runtimeBranchKey("ws-B", "u", "default"); // same branchId "default", different workspace
    assert("same branchId, different workspaces → DISTINCT rooms (isolation)", wsA !== wsB, `${wsA} vs ${wsB}`);
  }
  {
    const a = runtimeBranchKey("ws-1", "u", "branch-2");
    const b = runtimeBranchKey("ws-1", "u", "default");
    assert("different branches, same workspace → distinct rooms", a !== b);
  }
  {
    const legacy = runtimeBranchKey(null, "userA", "default");
    assert("legacy null workspace → explicit legacy:userId:branch key", legacy === "legacy:userA:default");
    assert("legacy key never forms a null-room", !legacy.includes("null") && !legacy.startsWith("ws::") && isLegacyRoomKey(legacy));
    const legacyB = runtimeBranchKey("", "userB", "default"); // empty string also legacy
    assert("legacy keys are per-user (A ≠ B)", legacy !== legacyB);
    assert("legacy key cannot collide with a workspace key", legacy !== runtimeBranchKey("userA", "userA", "default"));
  }
  {
    assert("workspaceScopeKey: same ws (diff users) → same scope", workspaceScopeKey("ws-1", "a") === workspaceScopeKey("ws-1", "b"));
    assert("workspaceScopeKey: legacy per-user", workspaceScopeKey(null, "userA") === "legacy:userA");
    assert("workspaceScopeKey: distinct workspaces isolated", workspaceScopeKey("ws-A", "u") !== workspaceScopeKey("ws-B", "u"));
  }

  // ── BLOCKER 1: owner_global branch authorization (workspace scope is necessary but NOT sufficient) ────────
  {
    const owner = { scopeKey: "ws:ws-1", authorizedBranches: ["branch-A"] };
    assert("owner sees authorized branch in own workspace", ownerReceivesBranch(owner, { scopeKey: "ws:ws-1", branchId: "branch-A" }));
    assert("owner does NOT see unauthorized branch (same workspace) — BLOCKER 1", !ownerReceivesBranch(owner, { scopeKey: "ws:ws-1", branchId: "branch-B" }));
    assert("owner does NOT see another workspace's branch", !ownerReceivesBranch(owner, { scopeKey: "ws:ws-2", branchId: "branch-A" }));
    const legacyOwner = { scopeKey: "legacy:u", authorizedBranches: null };
    assert("legacy-claim owner restricted to default only", ownerReceivesBranch(legacyOwner, { scopeKey: "legacy:u", branchId: "default" }) && !ownerReceivesBranch(legacyOwner, { scopeKey: "legacy:u", branchId: "branch-A" }));
    // isBranchAllowed direct
    assert("isBranchAllowed: null claim → default only", isBranchAllowed("default", null) && !isBranchAllowed("branch-A", null));
    assert("isBranchAllowed: claim gates", isBranchAllowed("branch-A", ["branch-A"]) && !isBranchAllowed("branch-B", ["branch-A"]));
  }

  // ── BLOCKER 2: COMMAND room isolation (targetDeviceId can never cross the caller's room) ──────────────────
  {
    const expected = runtimeBranchKey("ws-1", "u", "branch-A"); // ws:ws-1:branch-A
    const sameRoomMaster = { role: "device", mode: "MASTER", roomKey: expected };
    const otherBranchMaster = { role: "device", mode: "MASTER", roomKey: runtimeBranchKey("ws-1", "u", "branch-B") };
    const otherWsMaster = { role: "device", mode: "MASTER", roomKey: runtimeBranchKey("ws-2", "u", "branch-A") };
    const sameRoomControl = { role: "device", mode: "CONTROL", roomKey: expected };
    assert("command allowed to same-room MASTER", commandTargetInRoom(expected, sameRoomMaster));
    assert("command BLOCKED to MASTER in another branch (same ws) — BLOCKER 2", !commandTargetInRoom(expected, otherBranchMaster));
    assert("command BLOCKED to MASTER in another workspace", !commandTargetInRoom(expected, otherWsMaster));
    assert("command BLOCKED to a non-MASTER in same room", !commandTargetInRoom(expected, sameRoomControl));
    assert("command BLOCKED when target missing", !commandTargetInRoom(expected, null));
  }

  // ── Versioned lease store: legacy userId-scoped files are ignored, not misread ────────────────────────────
  {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "vono-lease-"));
    process.env.RAILWAY_VOLUME_MOUNT_PATH = tmp; // master-lease-store computes LEASE_FILE from this at import
    const leaseDir = path.join(tmp, "ws-lease");
    mkdirSync(leaseDir, { recursive: true });
    const leaseFile = path.join(leaseDir, "master-lease.json");
    // A legacy (unversioned, userId:branchId keyed) file:
    writeFileSync(leaseFile, JSON.stringify({ masterByBranch: { "user1:default": "dev-legacy" }, masterDisconnectedAt: {}, primaryMasterByBranch: { "user1:default": "dev-legacy" } }));
    const store = await import("./master-lease-store.js");
    const loaded = store.loadLease();
    assert("legacy unversioned lease is IGNORED (start fresh)", Object.keys(loaded.masterByBranch).length === 0);
    assert("loaded snapshot carries current version", loaded.version === store.LEASE_FORMAT_VERSION);
    // Save v2 workspace-scoped keys and reload:
    store.saveLease({ masterByBranch: { "ws:ws-1:default": "dev-new" }, masterDisconnectedAt: {}, primaryMasterByBranch: { "ws:ws-1:default": "dev-new" } });
    const reloaded = store.loadLease();
    assert("v2 workspace-scoped lease round-trips", reloaded.masterByBranch["ws:ws-1:default"] === "dev-new");
    const onDisk = JSON.parse(readFileSync(leaseFile, "utf-8")) as { version?: number };
    assert("persisted file is stamped with the format version", onDisk.version === store.LEASE_FORMAT_VERSION);
    // A caller's snapshot.version must NOT override the required current version.
    store.saveLease({ version: 999, masterByBranch: {}, masterDisconnectedAt: {}, primaryMasterByBranch: {} } as never);
    const overridden = JSON.parse(readFileSync(leaseFile, "utf-8")) as { version?: number };
    assert("snapshot.version cannot override persisted lease version", overridden.version === store.LEASE_FORMAT_VERSION);
    rmSync(tmp, { recursive: true, force: true });
  }

  // ── Static guards on server/index.ts ──────────────────────────────────────────────────────────────────────
  {
    const src = readFileSync(path.join(here, "index.ts"), "utf-8");
    assert("no old branchKey() calls remain", !/\bbranchKey\(/.test(src));
    assert("runtime room key helper is used", /runtimeBranchKey\(/.test(src));
    assert("REGISTER consumes the SIGNED workspaceId", /workspaceId\s*=\s*auth\.workspaceId/.test(src));
    assert("workspaceId is never read from the REGISTER body/message", !/msg\.workspaceId|validation\.workspaceId|m\.workspaceId/.test(src));
    assert("DeviceConnection carries roomKey", /roomKey:\s*string/.test(src));
    assert("state broadcast routes by roomKey", /c\.roomKey === roomKey/.test(src) && /d\.roomKey === roomKey/.test(src));
    assert("owner state fan-out gated by ownerReceivesBranch (scope + authz)", /ownerReceivesBranch\(o, \{ scopeKey, branchId \}\)/.test(src));
    assert("owner branch-list gated by ownerReceivesBranch", /getBranchListForOwner/.test(src) && /ownerReceivesBranch\(owner,/.test(src));
    assert("COMMAND enforces room isolation via commandTargetInRoom", /commandTargetInRoom\(expectedRoomKey, target\)/.test(src));
    assert("master maps are keyed by the room key (getMasterForRoom)", /function getMasterForRoom\(key: string\)/.test(src));
    assert("server/index.ts imports NO Prisma", !/@prisma\/client|["'].*lib\/prisma|PrismaClient/.test(src));
    assert("authorizedBranches still enforced per user (isBranchAllowed)", /isBranchAllowed\(/.test(src));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
}

void main();
