# Architecture Decision: SyncBiz Player Desktop & Announcements/Jingles (v1)

**Status:** Locked for upcoming phase  
**Scope:** Design intent only — no implementation in this document.

---

## Purpose

Record the agreed split of responsibilities between SyncBiz Web, SyncBiz Player Desktop, and the playback engine for cloud-managed announcements and jingles executed at each branch.

---

## System layers (locked)

### 1. SyncBiz Web — Control and media management layer

- Manages users.
- Manages workspaces and branches.
- Manages the announcements and jingles library.
- Manages scheduling.
- Stores asset metadata and cloud backup.
- Sends remote playback commands to branch devices.

### 2. SyncBiz Player Desktop — Branch runtime layer

- Installed on the branch computer.
- Registers as a device.
- Bound to a workspace / branch.
- Receives commands from the cloud.
- Shows local device and player state.
- Performs actual playback.
- Executes announcements and jingles locally.

### 3. Playback engine — Execution layer

- **MPV** is the internal playback engine.
- Receives play, pause, stop, volume, resume, and load commands.
- Acts as execution only; it does not own business logic.

---

## Principles (locked)

| Principle | Statement |
|-----------|-----------|
| Web vs playback | The web does **not** perform playback. |
| Branch playback | The desktop player **does** perform playback. |
| MPV’s role | MPV is the engine, not the system brain. |
| Announcements/jingles | Managed in the cloud; **executed** locally. |
| Cloud storage | Serves as asset storage and backup. |
| Branch model | Each branch operates through an assigned local device/runtime. |
| Product shape | SyncBiz remains a **cloud SaaS control system** plus **local branch player** architecture. |

---

## Phase 1 scope (announcements/jingles)

- **Desktop framework:** Electron.
- **Playback engine:** MPV.
- **Basic announcement flow:** pause current playback → play announcement → resume.
- **Assets:** cloud-managed generation and storage.
- **Explicitly out of Phase 1:** ducking, zone playback, advanced audio mixing.

---

## Decision summary

Control, catalog, scheduling, and asset lifecycle stay in the cloud; the branch desktop player is the sole runtime that honors remote commands and drives MPV. MPV remains a thin execution layer under player logic owned by the desktop app.
