# SyncBiz Control-Plane Architecture

## Overview

SyncBiz remote control evolved from LAN-oriented to **cloud-routed global control**. The owner can control branch players from anywhere (desktop, mobile) without being on the same Wi-Fi as the target.

---

## Connection Roles

| Role | Identity | Scope | Purpose |
|------|----------|-------|---------|
| **main_master_player** | deviceId, branchId, userId | Branch | Desktop/laptop that outputs audio at a branch |
| **secondary_desktop_controller** | deviceId, branchId, userId | Branch | Another desktop at same branch (CONTROL mode) |
| **mobile_controller** | deviceId, branchId?, userId | Branch or global | Mobile phone controlling playback |
| **mobile_player** | deviceId, branchId, userId | Branch | Mobile in local player mode |
| **owner_global_controller** | userId | Global | Owner connecting from anywhere; targets any branch |
| **guest** | (future) | Branch | Guest recommendations; lower priority |

---

## Identity Model

Every connection identifies with:

- **userId** – From auth (email). Account/owner identifier.
- **branchId** – Branch/location. Required for devices; optional for controllers; absent for owner.
- **deviceId** – Unique per browser (localStorage UUID). Not used for owner.
- **deviceType** – One of the roles above.

---

## Branch-Aware Routing

- **Devices** register with `(userId, branchId, deviceId)`.
- **Controllers** register with `(userId, branchId?, deviceId)` – branchId optional for branch-scoped control.
- **Owner** registers with `(userId)` only – no branchId.

Commands are routed by **explicit target**:

- **Local controller**: Targets MASTER of same (userId, branchId). Uses existing routing.
- **Owner**: Sends `COMMAND` with `targetBranchId`. Server routes to MASTER of that branch for that userId.

---

## Control-Plane Model

### Device Registration

1. Client connects to WS (public URL, e.g. `wss://ws.syncbiz.app`).
2. Sends `REGISTER` with role, authToken (from `/api/auth/ws-token`), branchId (if device/controller), deviceId (if device). Server derives userId from authToken; client never sends userId.
3. Server stores connection, assigns MASTER if first device at branch.

### Device Presence

- Connected devices and controllers are tracked in memory.
- MASTER per branch is tracked: `masterByBranch[userId:branchId] = deviceId`.
- Owner receives `BRANCH_LIST` with branches that have connected MASTER devices.

### Branch Membership

- MVP: Owner has access to all branches in their account (userId).
- Devices belong to a branch via branchId.
- No cross-account access.

### Owner Targeting

- Owner sends `BRANCH_LIST_REQUEST` → receives `BRANCH_LIST`.
- Owner sends `COMMAND` with `targetBranchId` → routed to that branch’s MASTER.

### Command Routing

| Sender | Target | Routing |
|--------|--------|---------|
| Device (MASTER) | Self | N/A |
| Controller (branch) | MASTER of same branch | By (userId, branchId) |
| Owner | MASTER of target branch | By targetBranchId |

### Permissions

| Actor | Can do |
|-------|--------|
| **Owner** | See all branches, target any branch, send all commands |
| **Local operator** (controller at branch) | Control MASTER of own branch only |
| **Guest** (future) | Recommend only; no direct control |

---

## Moving Away from Local-Network Assumptions

| Before | After |
|--------|-------|
| `NEXT_PUBLIC_WS_URL` default `ws://localhost:3001` | Deploy WS server with public URL (e.g. `wss://ws.yourapp.com`); set `NEXT_PUBLIC_WS_URL` in env |
| Implicit single-session per user | Explicit branch targeting |
| Commands by userId only | Commands by (userId, targetBranchId) |
| No owner role | Owner role for global control |

**Still local-only (for now):**

- `play-local` API (opens URL on server machine) – branch-specific.
- Agent/endpoint device control – may stay local for latency.

---

## First Implementation Scope

1. Owner can connect remotely (role `owner_global`).
2. Owner receives `BRANCH_LIST` of branches with connected MASTER devices.
3. Owner can target one branch and send: play, pause, next, prev, load playlist, play source.
4. Backward compatible: devices/controllers without branchId use `"default"`.
