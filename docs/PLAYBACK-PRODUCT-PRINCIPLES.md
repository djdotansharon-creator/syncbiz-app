# Playback product principles — network + local, one transport model

**Purpose:** Product and architecture alignment for SyncBiz playback. This does **not** replace detailed engine or MPV specs; it frames *how* they fit together.

---

## What SyncBiz must support (both, always)

| Track | Meaning |
|-------|---------|
| **1. URL / remote / provider** | Network-backed playback (streams, YouTube, SoundCloud, `http(s)` sources, app-managed providers, etc.) |
| **2. Local files on the branch computer** | Files on disk (or resolvable `file://` / OS paths) on the **machine that runs the branch player (desktop)**, as a **first-class** source type — not a hack or an afterthought |

Both sit under a **single SyncBiz transport/state model**: same concepts of source, queue, play/pause/stop, and app-level truth; **orchestration** is unified, **execution** is delegated by surface.

---

## How to frame MPV (desktop)

- **MPV is not** “the only way SyncBiz plays anything” or “replace everything.”
- **MPV is** the **real local execution engine** for **SyncBiz Player Desktop** when output must be produced on the **branch computer** (decode, output, local transport controls) — the layer that **runs** what the app asked for, not the layer that **decides** business rules, schedules, or catalog semantics.

**Engines only execute** — they do not own workspace/branch rules, queue policy, or multi-source product logic. That remains in app orchestration.

---

## What stays the source of truth for “brain” vs “muscle”

| Layer | Role |
|-------|------|
| **`PlaybackProvider` (`lib/playback-provider.tsx`)** | **Orchestration brain**: current source, track index, queue, status, and dispatch rules — one place for app-level playback state and intent. |
| **Web / embedded / browser** | Continues to handle URL/provider playback **in the browser** (iframes, `<audio>`, etc.) for surfaces that are not the desktop engine. **Browser playback must not be broken** by desktop/MPV work. |
| **Desktop + MPV (and related main-process bridges)** | **Strong local playback** on the station machine: in particular **local file** and any path where the product requires OS-level output (e.g. multi-tab policy, `play-local` handoff, branch audio on the same box). |

---

## Non-goals (for clarity)

- Replacing all network playback with MPV in one shot.
- Treating “local” as a second-tier mode — it is **first-class** alongside URLs/providers.
- Duplicating orchestration inside MPV or inside engine-only code paths — **PlaybackProvider** (and the existing device/remote shell) still coordinate intent.

---

## Related docs (implementation detail)

- `docs/MPV-INTEGRATION-PLAN-v1.md` — how MPV fits as **execution** on desktop Phase 1.
- `docs/PLAYER-DESKTOP-INTERNAL-STRUCTURE-v1.md` — desktop module boundaries (renderer, agent, main, WebSocket, etc.).

**Direction in one line:** *Support both network/URL/provider playback and local-computer playback under one SyncBiz transport/state model; MPV strengthens local execution on desktop without collapsing source-type diversity or breaking the browser path.*
