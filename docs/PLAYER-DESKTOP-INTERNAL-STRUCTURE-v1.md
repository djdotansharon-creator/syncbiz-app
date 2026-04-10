# SyncBiz Player Desktop — Internal Structure (Phase 1, v1)

**Status:** Design intent for Phase 1  
**Framework:** Electron (renderer + main process)  
**Engine:** MPV (execution only)  
**Scope:** Module boundaries and responsibilities — no implementation in this document.

**Context:** SyncBiz Web is the cloud control layer. The desktop app is the local branch runtime. Announcements and jingles are cloud-managed; execution is local. See `docs/ARCHITECTURE-DECISION-syncbiz-player-desktop-announcements-v1.md` for the locked system split.

---

## 1. Main process

| Concern | Responsibility |
|--------|----------------|
| **App lifecycle** | Starts and tears down the app; owns window creation, global shortcuts (if any), and clean shutdown (flush state, close sockets, stop child processes). |
| **Single-instance** | Ensures one player instance per machine (or per install profile); second launches forward to the running instance or exit with clear messaging. |
| **Updater hooks** | Integrates with the chosen update channel (e.g. check, download, apply on restart); defers risky updates during active playback when policy requires it. |
| **Native OS integration** | Tray icon, autostart policy hooks, OS notifications where appropriate, and platform-specific behavior without duplicating business logic in the main process. |
| **Process supervision / watchdog entry points** | Spawns and owns the MPV child process (or IPC bridge to it); exposes hooks to the watchdog layer for health checks and controlled restart. |

The main process holds privileged capabilities; it should pass structured messages to the renderer and agents rather than embedding playback policy.

---

## 2. Renderer

| Concern | Responsibility |
|--------|----------------|
| **Local UI** | Branch-facing operator surface built with web technologies inside Electron’s renderer. |
| **Device / player state** | Read-only or lightly controlled display of binding, connection status, current track/position (as reported by agents), and announcement activity. |
| **Operator controls** | Local actions allowed by product policy (e.g. volume, pause/resume override, reconnect); forwards intents to the main process or agents — does not talk to MPV directly. |
| **Status / errors / logs** | Compact views for operators and support: last errors, reconnect state, and filtered log tail or export trigger — without exposing secrets. |

The renderer is presentation and intent; it does not own cloud protocol or MPV translation.

---

## 3. Local playback agent

| Concern | Responsibility |
|--------|----------------|
| **Owns playback commands** | Single owner of “what should MPV do next” in response to app-level intents (load, play, pause, stop, volume, seek/resume as applicable in Phase 1). |
| **MPV translation** | Maps normalized app commands to MPV IPC or CLI as chosen in implementation; keeps MPV-specific details out of other modules. |
| **Playback state** | Tracks observable state (playing, paused, position, current item identity) synchronized with actual engine feedback where possible. |
| **Announcement interruption / resume (Phase 1)** | Implements the locked flow: pause (or hold) current playback → play announcement → restore prior playback state; no ducking or multi-zone mixing in Phase 1. |

This agent is the “brain” for local playback orchestration; MPV remains dumb execution.

---

## 4. Device WebSocket client

| Concern | Responsibility |
|--------|----------------|
| **Cloud connection** | Maintains authenticated, resilient connection from the desktop app to SyncBiz cloud (or edge) for the bound device. |
| **Remote commands** | Receives normalized remote commands (e.g. play playlist item, volume, announcement trigger) and dispatches them to the appropriate internal handler. |
| **State uplink** | Pushes local player and device state (connection, playback summary, errors, announcement phase) on a defined cadence or on change, per cloud contract. |

Protocol versioning and auth token refresh belong here or in a thin companion; business rules for *when* to play stay split between cloud scheduling and local agents.

---

## 5. Announcement module

| Concern | Responsibility |
|--------|----------------|
| **Requests** | Accepts “play announcement” intents from the WebSocket client (or internal queue) with stable identifiers and parameters. |
| **Readiness** | Validates prerequisites: device bound, engine reachable, asset available or fetchable, and non-conflicting policy gates for Phase 1. |
| **Asset resolution** | Resolves media via local cache, temp download from cloud, or pre-staged paths; fails gracefully with actionable errors. |
| **Coordination** | Orchestrates with the playback agent for pause → play announcement → resume; does not send raw MPV strings from the network edge without validation. |

---

## 6. Watchdog / resilience layer

| Concern | Responsibility |
|--------|----------------|
| **MPV failure detection** | Detects crash, hang, or lost IPC against defined timeouts and signals. |
| **Restart policy** | Triggers controlled MPV restart via main process hooks; avoids restart storms (backoff, max attempts). |
| **Runtime health** | Monitors WebSocket connectivity, disk space for cache, and critical agent responsiveness at a high level. |
| **Reconnect / recovery** | Defines strategy: exponential backoff for cloud reconnect, replay or reconcile state after reconnect, and surfacing degraded mode to UI and uplink. |

---

## 7. Local storage / config / logs / cache

| Area | Responsibility |
|------|----------------|
| **Branch / device binding** | Persistent identity: workspace, branch, device id, credentials or tokens (stored securely per platform). |
| **Local config** | Operator-tunable and policy flags (paths, volume caps, log level) separate from secrets. |
| **Temp / cache media** | Bounded cache for announcement and jingle assets; eviction policy aligned with cloud metadata. |
| **Logs** | Structured logs for support and recovery (rotation, redaction); correlation ids for sessions and announcement runs. |

---

## 8. High-level communication flow (Phase 1)

1. **Main process** starts, enforces single instance, loads **config/binding**, spawns **MPV** under supervision, and opens the **renderer** window.
2. **Device WebSocket client** connects to cloud using binding; receives **remote commands** and forwards playback intents to the **playback agent**; announcement triggers go to the **announcement module**.
3. **Playback agent** drives **MPV** and updates **playback state**; state changes are published internally (e.g. event bus or IPC) to the **renderer** and aggregated for **uplink** via the WebSocket client.
4. **Announcement module** validates and resolves assets, then coordinates with the **playback agent** for interrupt → play → resume.
5. **Watchdog** observes MPV and connection health; on failure, coordinates restart/reconnect and surfaces status to **renderer** and uplink.

Cross-cutting: all modules use clear boundaries — **renderer** for UI only; **WebSocket client** for wire format; **playback agent** for MPV; **announcement module** for interrupt orchestration; **main process** for OS and process ownership.

---

## Summary

Phase 1 desktop structure is: **main process** (lifecycle, OS, child supervision), **renderer** (local UI), **playback agent** (command ownership + MPV + interrupt/resume), **device WebSocket client** (cloud I/O), **announcement module** (asset + interrupt coordination), **watchdog** (resilience), and **local persistence** (binding, config, cache, logs). MPV stays execution-only; cloud remains control and catalog.
