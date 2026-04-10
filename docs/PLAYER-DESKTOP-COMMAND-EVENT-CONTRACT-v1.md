# SyncBiz Player Desktop — Command & Event Contract (Phase 1, v1)

**Status:** Design intent for Phase 1  
**Parties:** SyncBiz Web / cloud control layer ↔ SyncBiz Player Desktop (branch runtime)  
**Scope:** Normalized commands (cloud → desktop) and events (desktop → cloud). No wire format, no implementation.

**References:** `docs/ARCHITECTURE-DECISION-syncbiz-player-desktop-announcements-v1.md`, `docs/PLAYER-DESKTOP-INTERNAL-STRUCTURE-v1.md`.

---

## Boundaries (locked)

| Rule | Meaning |
|------|--------|
| Web does not perform playback | All play/pause/stop/volume execution happens on the desktop. |
| Desktop performs playback | The player app owns local orchestration and drives the engine. |
| MPV is execution only | MPV receives translated commands; it does not interpret cloud semantics. |
| Desktop owns local execution logic | Validation, interruption/resume, asset resolution, and engine health are local. |
| Cloud owns control, scheduling, catalog | Commands originate from policy/scheduling; metadata and library live in cloud. |
| Phase 1 only | No ducking, zones, advanced mixing, or speculative future commands in this contract. |

---

## 1. Command types (cloud → desktop)

All commands carry at minimum: **`commandId`** (unique per issuance), **`deviceId`**, **`workspaceId`**, **`branchId`**, and **`issuedAt`** (ISO-8601). Payloads below are *additional* minimum fields.

**Local handling target:** the module that should receive the intent first (actual routing is an implementation detail).

| Command | Purpose | Minimum payload | Required identifiers | Local handling target | Success / failure (high level) |
|---------|---------|-----------------|----------------------|------------------------|--------------------------------|
| **PLAY_TARGET** | Load and play a scheduled or requested item (e.g. playlist entry, URL, or stable cloud reference). | `targetRef` (cloud-stable id or URI contract), optional `positionMs` if resuming. | Same as global + `targetRef`. | Playback agent (after validation). | **Success:** playback starts or queues per local policy. **Failure:** invalid ref, engine unavailable, or local reject → `COMMAND_FAILED`. |
| **PLAY_ANNOUNCEMENT** | Interrupt normal playback for a cloud-managed announcement/jingle (Phase 1: pause → play → resume). | `announcementId`, `assetRef` (or equivalent to resolve/download asset). | Same as global + `announcementId`, `assetRef`. | Announcement module → playback agent. | **Success:** announcement plays and flow completes or clean abort. **Failure:** readiness/asset/engine → `ANNOUNCEMENT_FAILED` / `COMMAND_FAILED`. |
| **PAUSE** | Pause current playback. | None beyond global. | Global. | Playback agent. | **Success:** paused or idempotent no-op if already paused. **Failure:** engine unavailable → `COMMAND_FAILED`. |
| **RESUME** | Resume after pause (not a substitute for post-announcement restore, which is local orchestration). | None beyond global. | Global. | Playback agent. | **Success:** resumed or appropriate no-op. **Failure:** nothing to resume / engine error → `COMMAND_FAILED`. |
| **STOP** | Stop playback and clear “current” as defined by Phase 1 policy. | Optional `reason` (opaque string for logs). | Global. | Playback agent. | **Success:** stopped. **Failure:** engine unavailable → `COMMAND_FAILED`. |
| **SET_VOLUME** | Set output volume within local policy bounds. | `volume` (0–100 or normalized scalar per product spec). | Global. | Playback agent. | **Success:** volume applied. **Failure:** out of range / engine error → `COMMAND_FAILED`. |
| **PING** | Liveness and optional capability snapshot for control plane. | Optional `correlationId`. | Global. | Device WebSocket client + health aggregation. | **Success:** `COMMAND_ACK` or dedicated pong event with timestamp. **Failure:** timeout / unhealthy → `COMMAND_FAILED` or implicit offline path. |

Commands not listed are out of scope for Phase 1.

---

## 2. Event types (desktop → cloud)

All events carry at minimum: **`eventId`**, **`deviceId`**, **`workspaceId`**, **`branchId`**, **`emittedAt`**, and when applicable **`commandId`** (the command they acknowledge or relate to).

| Event | Purpose | Minimum payload | When emitted |
|-------|---------|-----------------|--------------|
| **DEVICE_ONLINE** | Device connected and authenticated. | `sessionId` or connection id, optional `appVersion`. | After successful bind + socket ready. |
| **DEVICE_OFFLINE** | Device disconnected or deliberate shutdown. | `reason` (e.g. `shutdown`, `network`, `crash`). | On clean disconnect or when connection lost (debounced if needed). |
| **PLAYBACK_STATE_CHANGED** | Observable playback state changed. | `state` (`playing` \| `paused` \| `stopped` \| `idle`), optional `targetRef`, optional `positionMs`. | On material state change (debounced/throttled per policy). |
| **ANNOUNCEMENT_STARTED** | Announcement playback has begun after readiness. | `announcementId`, optional `commandId`. | When announcement asset is playing. |
| **ANNOUNCEMENT_FINISHED** | Announcement completed and handoff to restore logic done or skipped. | `announcementId`, `outcome` (`completed` \| `aborted`). | After announcement ends and local restore step is resolved. |
| **ANNOUNCEMENT_FAILED** | Announcement could not complete as requested. | `announcementId`, `errorCode` (see §5), optional `commandId`, optional `detail` (sanitized). | On readiness failure, asset failure, engine failure during announcement, or unrecoverable interrupt. |
| **COMMAND_ACK** | Command accepted and execution started or completed synchronously. | `commandId`, `status` (`accepted` \| `completed`). | Immediately when accepted, and/or when a short command finishes (e.g. PING, SET_VOLUME). |
| **COMMAND_FAILED** | Command rejected or execution failed. | `commandId`, `errorCode`, optional `detail` (sanitized). | On validation failure, policy reject, timeout, or engine error for that command. |
| **ENGINE_ERROR** | MPV or bridge failure not tied to a single command. | `errorCode`, optional `recovering` boolean. | On crash, IPC loss, or watchdog-triggered recovery. |

---

## 3. Command lifecycle

1. **Issue:** Cloud sends a command with `commandId` and routing identifiers.
2. **Receive:** Desktop WebSocket client receives the message and dispatches to the appropriate handler.
3. **Validate:** Handler checks schema, device binding, engine reachability (where required), and local policy (e.g. volume range).
4. **Execute or reject:** On success, the playback agent or announcement module performs work; on failure, no partial cloud-truth without a matching event.
5. **Report:** Desktop emits **`COMMAND_ACK`** (accepted and/or completed for simple commands), **`COMMAND_FAILED`**, or domain events (**`PLAYBACK_STATE_CHANGED`**, **`ANNOUNCEMENT_*`**, **`ENGINE_ERROR`**) as applicable.

**Ordering:** For a single `commandId`, cloud should treat **`COMMAND_FAILED`** or **`COMMAND_ACK` (completed)** as terminal; overlapping commands should be defined by product policy (Phase 1: recommend serializing playback-changing commands per device).

---

## 4. Announcement-specific flow (Phase 1)

**Goal:** `pause → play announcement → resume` — no ducking, no zones.

| Step | Direction | Description |
|------|-----------|-------------|
| 1 | Cloud → Desktop | **`PLAY_ANNOUNCEMENT`** with `commandId`, `announcementId`, `assetRef`. |
| 2 | Desktop | **Readiness:** bound device, engine up, asset resolvable (cache/download/path), no blocking local policy. |
| 3 | Desktop | On readiness failure → **`COMMAND_FAILED`** or **`ANNOUNCEMENT_FAILED`** with `asset_not_ready` / `asset_unavailable` / `engine_unavailable` as appropriate; stop. |
| 4 | Desktop | **Interrupt:** playback agent captures resumable context (e.g. prior target + position + paused/playing); **pause** current playback. |
| 5 | Desktop | **Play:** load announcement asset into MPV and play; emit **`ANNOUNCEMENT_STARTED`**. |
| 6 | Desktop | **End:** on natural end or controlled stop, emit **`ANNOUNCEMENT_FINISHED`**; **restore** prior playback (resume or reload + seek per captured context). |
| 7 | Desktop | If restore impossible → **`ANNOUNCEMENT_FINISHED`** with outcome `aborted` and/or **`COMMAND_FAILED`** with `resume_not_possible`; emit **`PLAYBACK_STATE_CHANGED`** reflecting actual state. |
| 8 | Desktop | Emit **`COMMAND_ACK` (completed)** for the original `commandId` when the full Phase 1 sequence succeeds or fails in a defined terminal way (align terminal event with ack policy in implementation). |

Cloud does not perform playback; it may infer progress only from emitted events.

---

## 5. Error / status model (Phase 1)

Operational **`errorCode`** values (string enum; exact naming can be aligned in implementation):

| Code | Meaning |
|------|--------|
| `invalid_command` | Unknown type, bad payload, or wrong device/workspace/branch. |
| `unauthorized` | Auth or binding mismatch. |
| `asset_not_ready` | Asset known but not yet local / download in progress (optional retry policy). |
| `asset_unavailable` | Asset cannot be fetched or resolved. |
| `engine_unavailable` | MPV not running or IPC down. |
| `command_timeout` | Command did not complete within local/cloud timeout. |
| `resume_not_possible` | Post-announcement restore failed (missing context, target gone, engine error). |
| `policy_reject` | Locally disallowed (e.g. volume cap). |
| `internal_error` | Unexpected local failure (logged with correlation). |

**Status reporting:** Prefer stable **`errorCode`** + optional sanitized **`detail`**; avoid leaking secrets or full stack traces on the wire.

---

## 6. Summary

Phase 1 contract: cloud issues **`PLAY_TARGET`**, **`PLAY_ANNOUNCEMENT`**, **`PAUSE`**, **`RESUME`**, **`STOP`**, **`SET_VOLUME`**, **`PING`**; desktop responds with **`COMMAND_ACK`**, **`COMMAND_FAILED`**, lifecycle **`ANNOUNCEMENT_*`**, **`PLAYBACK_STATE_CHANGED`**, **`ENGINE_ERROR`**, and connection **`DEVICE_ONLINE` / `DEVICE_OFFLINE`**. Execution and interruption logic stay on the desktop; MPV executes only; cloud remains control and catalog.
