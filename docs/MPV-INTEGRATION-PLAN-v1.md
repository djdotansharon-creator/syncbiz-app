# MPV Integration Plan — SyncBiz Player Desktop Phase 1 (v1)

**Status:** Technical integration design — no implementation, no wire protocol specification.  
**Locked alignment:** `docs/ARCHITECTURE-DECISION-syncbiz-player-desktop-announcements-v1.md`, `docs/PLAYER-DESKTOP-INTERNAL-STRUCTURE-v1.md`, `docs/PLAYER-DESKTOP-COMMAND-EVENT-CONTRACT-v1.md`, `docs/ANNOUNCEMENT-PLAYBACK-FLOW-v1.md`.

---

## 1. Integration objective

| Aspect | Definition |
|--------|------------|
| **Role** | MPV is the **local playback engine** for Phase 1 SyncBiz Player Desktop. |
| **Depth** | **Execution layer only** — decode, output, transport controls; no workspace/branch/catalog semantics. |
| **Control** | MPV is **driven exclusively by the desktop runtime** (playback agent via an MPV bridge), not by the cloud or the web app. |
| **Logic ownership** | **Business and orchestration logic** (announcements, snapshot/restore, validation) lives in the **playback agent** and **announcement module**; MPV does not own those rules. |

---

## 2. Integration model (recommended)

**Recommendation for Phase 1:** Run **MPV as a child process** started by the **Electron main process**, with control through **MPV’s JSON IPC** over a **local socket/pipe** (platform-appropriate). This matches common operational patterns, keeps renderer sandbox-friendly, and gives a clear text command surface without embedding native UI inside MPV for Phase 1.

| Concern | Owner / pattern |
|---------|-----------------|
| **Launch** | **Main process** spawns MPV with IPC enabled, configured paths, and logging as needed; passes the IPC path to the playback layer out-of-band (secure local channel). |
| **Communication** | **Playback agent** issues **normalized playback intents**; a thin **MPV bridge** (main process or dedicated helper process) translates those to **JSON IPC commands** (loadfile, set pause, seek, set volume, observe property changes). Prefer **one documented bridge** rather than ad-hoc CLI from multiple modules. |
| **Control path (design level)** | **IPC / JSON command style** — asynchronous requests + property observation for state (not raw CLI `mpv url` as the primary control loop for Phase 1). |
| **Main process owns** | Process lifecycle: start/stop/restart MPV; OS-level supervision hooks; forwarding IPC to the agent; optional single-writer policy so only the bridge talks to MPV. |
| **Playback agent owns** | Semantics: what to load, pause/resume/stop, seek targets for restore, interpretation of observed state into app-level playback truth, coordination with the announcement flow in `ANNOUNCEMENT-PLAYBACK-FLOW-v1.md`. |

**Alternative (not recommended for first integration):** Embedded **libmpv** in native code — higher integration cost for Electron Phase 1; defer unless IPC proves insufficient.

---

## 3. Minimum Phase 1 command surface (toward MPV)

The playback agent must be able to realize these capabilities **via the bridge** (exact IPC names are implementation detail):

| Capability | Purpose |
|------------|---------|
| **Load + play media** | Load `PLAY_TARGET` / announcement asset URI/path; start playback. |
| **Pause** | Interrupt flow: pause current line before announcement load. |
| **Resume** | Resume after pause or as part of restore when applicable. |
| **Stop** | Clear/stop per Phase 1 policy (`STOP` command, local idle). |
| **Volume set** | `SET_VOLUME`; optional **get** for UI truth if not solely echoed from last set. |
| **Current position read** | Poll or subscribe for **time-pos** (or equivalent) for snapshot and restore (`positionMs`). |
| **Playback state read** | Derive **playing / paused / idle** from core-idle, pause, eof-reached, etc. |
| **End-of-file detection** | Distinguish natural end vs stop for announcement completion and restore handoff. |
| **Error / failure detection** | Surface load errors, demuxer/decoder failures, unplayable paths. |
| **Seek** | **Required for restore** when policy is reload + seek (`ANNOUNCEMENT-PLAYBACK-FLOW-v1.md` §6). |

Anything not needed for locked playback + announcement flow is out of scope for the minimum surface.

---

## 4. Minimum state / events back from MPV

The runtime must observe enough to drive **contract events** and **announcement flow**:

| Observation | Use |
|-------------|-----|
| **Engine alive** | Watchdog; reject commands with `engine_unavailable`; `ENGINE_ERROR` / recovery. |
| **Media loaded** | Readiness before “announcement actually playing”; avoid false **`ANNOUNCEMENT_STARTED`**. |
| **Playing / paused / idle** | **`PLAYBACK_STATE_CHANGED`**; snapshot and restore decisions. |
| **Current position** | Snapshot (`positionMs`); seek-after-reload. |
| **End reached** | Announcement completion; trigger restore sequence. |
| **Playback error** | Load/play failure; feeds **`ANNOUNCEMENT_FAILED`** / **`COMMAND_FAILED`**. |
| **IPC disconnect / crash** | Treat as **engine unhealthy**; watchdog path; not a normal command failure alone. |

Prefer **property observation + event hooks** (where MPV exposes them) over tight polling loops; polling interval is an implementation detail.

---

## 5. Process ownership and watchdog expectations

| Question | Phase 1 answer |
|----------|----------------|
| **Who starts MPV?** | **Main process** (sole spawner for the child process). |
| **Who stops / restarts MPV?** | **Main process** on explicit shutdown or watchdog request; **playback agent** requests restart through a **single API** to avoid races. |
| **Watchdog interaction** | Watchdog monitors **process handle + IPC responsiveness**; on failure, requests **controlled restart** via main process; **playback agent** is notified to clear optimistic state and emit **`ENGINE_ERROR`** / truthful **`PLAYBACK_STATE_CHANGED`**. |
| **Engine unhealthy** | Includes: process exited unexpectedly, IPC **silent** beyond threshold, repeated command **rejection**, or **unrecoverable** error state after bounded retries. |
| **First-level restart policy** | **Bounded retries** (e.g. immediate one retry, then exponential backoff); **cap** attempts per window; surface **degraded** state to UI and uplink; do not tight-loop restart. |

---

## 6. Announcement-specific MPV needs

Mapped to `docs/ANNOUNCEMENT-PLAYBACK-FLOW-v1.md`:

| Flow need | MPV support |
|-----------|-------------|
| **Pause current playback** | Pause command / property before loading announcement. |
| **Load announcement asset** | Second load (replace or append policy **fixed for Phase 1** — recommend **replace** current playlist entry for simplicity: one active item). |
| **Detect actual announcement start** | Loaded + playing + time advancing (or equivalent) before **`ANNOUNCEMENT_STARTED`**. |
| **Detect completion / failure** | EOF vs error properties/events. |
| **Restore (resume or reload+seek)** | Resume if same media still loaded; else **loadfile** prior `targetRef` + **seek** to snapshot position when resumable. |

No ducking, zones, or parallel outputs — single logical stream consistent with Phase 1 docs.

---

## 7. Failure model (MPV-related, Phase 1)

| Situation | Operational outcome |
|-----------|----------------------|
| **Process not started** | Commands fail with `engine_unavailable`; **`COMMAND_FAILED`**; optional **`ENGINE_ERROR`** when unrecoverable without user action. |
| **Process crashed** | Watchdog detects exit; **`ENGINE_ERROR`**; restart per §5; playback truth → idle/stopped until restored. |
| **IPC unavailable** | Treat as **unhealthy engine**; same as crash path if process is gone; if process lives but IPC dead → restart bridge/engine. |
| **Media failed to load** | Load error surfaced; **`ANNOUNCEMENT_FAILED`** / **`COMMAND_FAILED`** with `asset_unavailable` or `engine_unavailable` as appropriate. |
| **Playback failed mid-stream** | **`ANNOUNCEMENT_FAILED`** or generic failure; attempt **restore** per flow doc; terminal **`COMMAND_FAILED`** if `commandId` applies. |
| **Seek / restore not possible** | **`resume_not_possible`**; **`PLAYBACK_STATE_CHANGED`** truthful; no fake success. |

---

## 8. Recommended Phase 1 implementation boundaries (do not do yet)

- **No ducking**, multi-track mixing tricks, or audio graph experiments.
- **No multi-zone** or multi-instance MPV for one branch in Phase 1 unless explicitly replanned.
- **No advanced mixing** (crossfade, EQ chains beyond defaults, etc.).
- **No visualizer** or video side features unless required for basic operator feedback.
- **No speculative performance optimization** (prefetch storms, parallel decode pools) before correctness and stability.
- **No broad “playback engine abstraction”** beyond a **single MPV bridge module** unless a second engine is scheduled — keep interfaces **thin and MPV-shaped** for Phase 1.

---

## 9. Practical next step after this document

**Exact next implementation step (when approved):** Create the **desktop runtime skeleton** in the designated desktop package (Electron main + renderer shell + placeholder modules per `PLAYER-DESKTOP-INTERNAL-STRUCTURE-v1.md`), **without** full product features — and in parallel define the **MPV bridge contract** (TypeScript types / message names for agent ↔ bridge ↔ IPC) as **empty or stub interfaces only** in that skeleton. **Do not** bundle MPV binaries or ship production IPC in that first step unless the team explicitly expands scope.

---

## Summary

Phase 1 integrates **MPV as a child process with JSON IPC**, owned by the **main process** for lifecycle and by the **playback agent** for semantics, supporting the **locked announcement flow** and **command/event contract**. Failures are **truthful**, **watchdog-backed**, and **bounded** — no extra engine features beyond this plan.
