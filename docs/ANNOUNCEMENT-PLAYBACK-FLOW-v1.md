# Announcement Playback Flow — Phase 1 (v1)

**Status:** Design intent for desktop runtime execution only  
**Scope:** Ordered behavior from `PLAY_ANNOUNCEMENT` through restore. No wire schema, no code.

**Locked references:** `docs/ARCHITECTURE-DECISION-syncbiz-player-desktop-announcements-v1.md`, `docs/PLAYER-DESKTOP-INTERNAL-STRUCTURE-v1.md`, `docs/PLAYER-DESKTOP-COMMAND-EVENT-CONTRACT-v1.md`. Event and command names in §7–§9 match that contract.

---

## 1. Scope of the flow

**In scope (Phase 1 only):**

- Cloud command arrives (`PLAY_ANNOUNCEMENT`).
- Desktop validates readiness.
- Current playback is interrupted (pause → play announcement → restore attempt).
- Announcement plays via the local engine.
- Previous playback is restored when the snapshot and engine allow it.

**Explicitly out of scope:**

- Ducking, zones, advanced mixing.
- Multiple simultaneous announcements (Phase 1 assumes at most one announcement flow at a time per device; overlapping commands are a product policy concern outside this flow’s happy path).
- Future AI rewrite logic or approval workflows.

---

## 2. Entry point

| Order | Module | Role |
|-------|--------|------|
| 1 | **Device WebSocket client** | First to receive `PLAY_ANNOUNCEMENT` from the cloud. Performs transport-level validity (authenticated session, routable to this device) and dispatches a single internal intent to the announcement layer with the full command payload including `commandId`. |
| 2 | **Announcement module** | Owns the Phase 1 announcement sequence: readiness, snapshot coordination, orchestration of interrupt → play → restore. It does not send raw MPV strings from the network. |
| 3 | **Playback agent** | Owns normalized playback operations (pause, load, play, seek/resume semantics), playback state truth, and translation to the MPV bridge. |
| 4 | **Main process / MPV bridge** | Spawns or holds the MPV process and IPC; executes only what the playback agent requests. Used when the agent must start or restart the engine or when child-process ownership is required. |

**Responsibility pass:** WebSocket client → **announcement module** (orchestration) → **playback agent** (all playback steps) → **main process / MPV bridge** (process and IPC only as needed). The renderer is updated via internal state channels; it is not the entry point for the command.

---

## 3. Readiness validation

Before any snapshot or pause, the announcement module (with playback agent/engine probes as needed) SHALL evaluate:

| Check | Meaning |
|-------|--------|
| **Device bound** | Persistent `deviceId` / workspace / branch binding matches the command’s routing identifiers. |
| **Runtime healthy enough** | WebSocket client is connected (or policy allows queued offline behavior — Phase 1 default: require connection to proceed with cloud-issued announcement). Process is not shutting down. |
| **Engine reachable** | MPV (or bridge) accepts commands; not in a known crashed state without a restart path. |
| **Asset resolvable** | `assetRef` resolves to a local path, cache hit, or successful fetch contract per product rules; “ready” means playable now or after a bounded prefetch defined for Phase 1. |
| **Local policy** | No local gate blocks announcements (maintenance mode, operator lockout, etc., if defined). |

**If any check fails:**

- Do not capture snapshot or pause for this announcement attempt.
- Emit **`COMMAND_FAILED`** with the appropriate `errorCode` (`unauthorized`, `invalid_command`, `engine_unavailable`, `asset_not_ready`, `asset_unavailable`, `policy_reject`, etc. per `PLAYER-DESKTOP-COMMAND-EVENT-CONTRACT-v1.md` §5).
- Emit **`ANNOUNCEMENT_FAILED`** when the failure is specific to the announcement path (readiness/asset/engine during announcement intent), including `announcementId` and optional `commandId`.
- Do not emit **`ANNOUNCEMENT_STARTED`** or **`ANNOUNCEMENT_FINISHED`** for that attempt.
- Leave playback unchanged.

---

## 4. Playback snapshot contract

Before interruption, the **playback agent** (invoked by the announcement module) SHALL capture a **playback snapshot** sufficient to attempt restore. Minimum fields:

| Field | Requirement |
|-------|-------------|
| **Current target identity** | Stable local or cloud reference for what was playing (e.g. `targetRef` or equivalent). |
| **Target type** | Category needed to choose restore strategy (e.g. file vs URL vs live/stream vs unknown). |
| **Current playback state** | At minimum: `playing` \| `paused` \| `stopped` \| `idle` as known to the agent. |
| **Current position** | Best-known position (e.g. `positionMs`) when the source supports it; nullable when unknown. |
| **Resumable flag** | Whether this source type/instance supports resume/reload+seek vs best-effort restart only. |
| **Restore metadata minimum** | Any additional identifiers required to reload the same logical item (e.g. playlist index, item id) if `targetRef` alone is insufficient in Phase 1. |

The snapshot is **logical**, not necessarily raw MPV internal state. If capture fails, treat as **interruption failed** (see §8).

---

## 5. Interruption flow (Phase 1 — exact order)

1. **Validate** — Run §3 readiness; on failure, stop (§3 outcomes).
2. **Capture snapshot** — Playback agent builds §4 snapshot from current truth; persist for the duration of the announcement flow.
3. **Pause current playback** — Playback agent pauses the current item (or transitions to a held paused state per product rules). Engine must reflect paused before loading announcement if policy requires a clean handoff.
4. **Load announcement asset** — Playback agent loads the resolved announcement media into the engine (via main process / bridge as needed).
5. **Play announcement** — Playback agent starts announcement playback.
6. **Detect completion or failure** — Agent observes end-of-file, error, or stop; distinguishes success vs playback failure.
7. **Attempt restore** — Apply §6 using the snapshot; then emit terminal events per §7.

No step reordering in Phase 1: snapshot before announcement load; pause before announcement play unless product policy explicitly defines an atomic “hold” equivalent to paused (documented as pause for this contract).

---

## 6. Restore / resume rules (Phase 1)

| Capability | Policy |
|------------|--------|
| **Resumable source** | Prefer **resume** from paused state if the same loaded media remains valid; otherwise **reload + seek** to `positionMs` when available. |
| **Non-resumable / live** | **Best-effort restart** of the same `targetRef` (or equivalent); position may be unknown; do not claim resume if unsupported. |
| **Snapshot missing or invalid** | Do not invent state; treat as restore failure (§8). |
| **Restore failure** | Emit terminal failure/status with **`resume_not_possible`** (or related codes); emit **`PLAYBACK_STATE_CHANGED`** with the **actual** local state (truthful). Do not pretend prior playback resumed. |

---

## 7. Event emission points

Mapping to the locked contract (names and purposes only):

| Point in flow | Events |
|---------------|--------|
| Command accepted, execution begun (after §3 pass) | **`COMMAND_ACK`** with `status: accepted` and `commandId`. |
| Readiness / validation failure (before announcement play) | **`COMMAND_FAILED`**; **`ANNOUNCEMENT_FAILED`** as applicable. No **`ANNOUNCEMENT_STARTED`**. |
| Announcement media actually playing | **`ANNOUNCEMENT_STARTED`** (`announcementId`, optional `commandId`); **`PLAYBACK_STATE_CHANGED`** if observable state changes. |
| During announcement | **`PLAYBACK_STATE_CHANGED`** as needed when state materially changes. |
| Announcement ended, restore attempted | **`ANNOUNCEMENT_FINISHED`** (`outcome`: `completed` or `aborted`); **`PLAYBACK_STATE_CHANGED`** reflecting post-restore truth. |
| Announcement path failure after start | **`ANNOUNCEMENT_FAILED`**; **`COMMAND_FAILED`** if tied to `commandId`; **`PLAYBACK_STATE_CHANGED`** as needed. |
| Engine failure not tied only to one command | **`ENGINE_ERROR`** per contract. |
| Full sequence terminal success | **`COMMAND_ACK`** with `status: completed` and `commandId` (align with contract note: terminal ack when the Phase 1 sequence completes successfully). |
| Full sequence terminal failure after partial progress | **`COMMAND_FAILED`** + applicable domain events; final state via **`PLAYBACK_STATE_CHANGED`**. |

**Note:** If **`COMMAND_ACK` (completed)** and **`ANNOUNCEMENT_FINISHED`** both apply, ordering SHOULD be: finish announcement domain events first, then playback state, then terminal **`COMMAND_ACK`** or **`COMMAND_FAILED`**, unless implementation ties terminal ack to a single aggregate — either way, cloud must see a consistent terminal outcome for `commandId`.

---

## 8. Failure paths (operational outcome)

| Failure | Outcome (high level) |
|---------|----------------------|
| **Asset not ready** | Abort before snapshot side effects if prefetch not done; emit **`COMMAND_FAILED`** / **`ANNOUNCEMENT_FAILED`** with `asset_not_ready`. Playback unchanged if pause not yet applied. |
| **Asset unavailable** | Same as above with `asset_unavailable`; no announcement play. |
| **Engine unavailable** | Abort before or during load/play with `engine_unavailable`; **`COMMAND_FAILED`**; **`ANNOUNCEMENT_FAILED`** if announcement context; possible **`ENGINE_ERROR`**. |
| **Interruption failed** | Snapshot or pause fails: emit **`COMMAND_FAILED`** / **`ANNOUNCEMENT_FAILED`** with appropriate code (`internal_error` or specific); do not start announcement; best effort to leave prior playback as it was. |
| **Announcement playback failed** | Emit **`ANNOUNCEMENT_FAILED`**; attempt restore per §6; emit **`ANNOUNCEMENT_FINISHED`** with `aborted` if applicable; **`PLAYBACK_STATE_CHANGED`** truthful; terminal **`COMMAND_FAILED`** for `commandId`. |
| **Restore not possible** | Emit **`ANNOUNCEMENT_FINISHED`** with `aborted` if announcement played; **`COMMAND_FAILED`** with `resume_not_possible`; **`PLAYBACK_STATE_CHANGED`** shows real state (e.g. idle or stopped). |

---

## 9. Summary sequence (happy path)

1. Cloud sends **`PLAY_ANNOUNCEMENT`** → desktop **WebSocket client** receives and forwards to **announcement module**.  
2. **Readiness** passes (bound, connected, engine up, asset resolvable, policy OK).  
3. **`COMMAND_ACK` (`accepted`)** for `commandId`.  
4. **Snapshot** captured → **pause** current playback → **load** announcement → **play** announcement.  
5. **`ANNOUNCEMENT_STARTED`**; **`PLAYBACK_STATE_CHANGED`** as needed.  
6. Announcement **completes** successfully.  
7. **`ANNOUNCEMENT_FINISHED`** (`completed`); **restore** prior playback per snapshot (resume or reload+seek).  
8. **`PLAYBACK_STATE_CHANGED`** reflects restored playback.  
9. **`COMMAND_ACK` (`completed`)** for `commandId`.

---

## Summary

Phase 1 announcement execution is a single linear pipeline owned by the **announcement module**, with **playback agent** owning snapshot, pause, load, play, restore semantics and **main process / MPV bridge** executing engine operations. Events remain those defined in the command/event contract; failures stay truthful and operational.
