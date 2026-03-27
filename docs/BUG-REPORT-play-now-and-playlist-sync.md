# PLAY NOW & Playlist Sync – Architecture Inspection Report

**Status:** Inspection only – no code changes made.

---

## 1. PLAY NOW Flow Analysis

### When controller internet search result is clicked with PLAY NOW

| Step | Component | Action |
|------|-----------|--------|
| 1 | `LibraryInputArea` or `UniversalSearchBar` | User clicks PLAY NOW on YouTube or Radio search result |
| 2 | `handlePlayYoutube` / `handlePlayRadio` | **YouTube:** `createPlaylistFromUrl()` → POST `/api/playlists` (saves to library first) |
| 3 | | **Radio:** POST `/api/radio` (creates radio station) |
| 4 | | `onAdd(u)` / `onAddSource(u)` – adds to local `SourcesPlaybackProvider` / `setSources` |
| 5 | | `playSource(u)` – from `usePlayback()` |
| 6 | `PlaybackProvider.playSource` | **Guard:** `if (!deviceModeAllowsLocalPlayback.current) return;` |
| 7 | | When MASTER: continues, sets `currentSource`, `status: "playing"` |
| 8 | | When CONTROL: **returns immediately** – no state change, no command sent |
| 9 | `DevicePlayerContext.playSourceOrSend` | **Never called** – LibraryInputArea uses raw `playSource`, not `playSourceOrSend` |

### Commands / messages sent

- **No** `PLAY_SOURCE` is sent when in CONTROL mode
- **No** `ADD_SOURCE` or `SAVE_PLAYLIST` WebSocket message exists
- **YouTube path:** POST `/api/playlists` (HTTP) creates playlist; then `playSource` is called locally only
- **Radio path:** POST `/api/radio` (HTTP) creates station; then `playSource` is called locally only

### Server / client path

| Path | Handler |
|------|---------|
| POST `/api/playlists` | Creates playlist in DB / local store |
| POST `/api/radio` | Creates radio station |
| `playSource` | `lib/playback-provider.tsx` – no-op when `deviceModeAllowsLocalPlayback.current === false` |
| `playSourceOrSend` | `lib/device-player-context.tsx` – sends `PLAY_SOURCE` to MASTER when in CONTROL – **not used by LibraryInputArea** |

### Why it does not play immediately

1. **CONTROL mode:** `LibraryInputArea` uses `usePlayback().playSource` directly. It does **not** use `playSourceOrSend`. When `deviceModeAllowsLocalPlayback.current` is false (CONTROL mode), `PlaybackProvider.playSource` returns immediately without updating state or sending any command.
2. **MASTER mode:** On MASTER, `playSource` should run and update state. If it still appears to “only add/store,” possible causes: API latency, `createPlaylistFromUrl` failure, or a different code path (e.g. `UniversalSearchBar` vs `LibraryInputArea`).

### Verdict

| Scenario | Current behavior | Verdict |
|----------|------------------|---------|
| **CONTROL mode** (second device, /sources in CONTROL) | PLAY NOW: saves via API, adds to local list, `playSource` no-ops, no command to MASTER | **Broken implementation** |
| **MASTER mode** | PLAY NOW: saves via API, adds to local list, `playSource` runs – should play | **Expected to work**; report if still failing |
| **/remote, /owner pages** | No internet search; only “Load playlist (URL)” | **Not applicable** |

---

## 2. Playlist / Library Sync Analysis

### Where playlist data is fetched

| Client | Location | When |
|--------|----------|------|
| **MASTER** | `app/(app)/sources/page.tsx` | Server `getUnifiedSources()` at **page render** → `initialSources` |
| **MASTER** | `components/sources-manager.tsx` | `effectiveSources` from `initialSources` or `fetchUnifiedSourcesWithFallback()` when `initialSources.length === 0` |
| **MASTER** | `app/(app)/library/page.tsx` | Client `useEffect` → `fetchUnifiedSourcesWithFallback()` once on **mount** |
| **Controller** | Same pages when in CONTROL mode | Same fetch patterns – no separate controller path |
| **Mobile** | `app/(app)/mobile/page.tsx` | `fetchUnifiedSourcesWithFallback()` on mount and on focus |

### Load strategy

- **Sources page:** Server fetch at render; `initialSources` passed to `SourcesManager`
- **Library page:** Client `useEffect([setQueue])` – single fetch on mount
- **SourcesManager:** `effectiveSources` synced from `initialSources` via `useEffect` when IDs change
- **No refetch** on playlist create/update/delete
- **No WebSocket** event for playlist changes

### WebSocket events today

| Event | Purpose |
|-------|---------|
| `COMMAND` | Playback control (PLAY, PAUSE, PLAY_SOURCE, etc.) |
| `STATE_UPDATE` | Playback state (currentSource, queue, status, position) |
| `DEVICE_LIST` | Connected devices, MASTER id, session code |
| *(none)* | Playlist / library / source list changes |

### Components using stale local state

| Component | Data source | Updates on |
|-----------|-------------|------------|
| `SourcesManager` | `initialSources` + `effectiveSources` | Mount, `initialSources` change |
| `LibraryPage` | `playlists` from `fetchUnifiedSourcesWithFallback()` | Mount only |
| `SourcesPlaybackProvider` | `sources` from props / parent | Parent `sources` change |
| `LibraryInputArea` | `onAdd` → `setSources` | Only local `handleAdd`; no cross-client sync |
| `UniversalSearchBar` | Same as above | Same |

---

## 3. Source of Truth Map

| Domain | Source of truth | Where it lives | Shared? |
|--------|------------------|----------------|---------|
| **Playback state** | `PlaybackProvider` | `lib/playback-provider.tsx` | Via `STATE_UPDATE` WS to CONTROL |
| **Playlist / library** | Per-client fetch | `initialSources`, `effectiveSources`, `playlists` | **No** – each client has own copy |
| **Search results** | Local `useState` | `youtubeResults`, `radioResults`, `localResults` in search components | **No** – ephemeral per session |
| **Controller action result** | Local `onAdd` / `setSources` | `SourcesPlaybackProvider.sources` | **No** – only on acting client |

### Where state is split

- **Playback:** One source of truth; MASTER holds it, CONTROL receives `STATE_UPDATE`.
- **Library/playlists:** Many independent copies (MASTER, CONTROL, mobile, library page), no coordination.
- **Search:** Ephemeral; not shared between clients.
- **Add result:** Only the client that called `onAdd` sees the new item; others need refresh.

---

## 4. Root Causes

### PLAY NOW not playing immediately

1. **LibraryInputArea** (and similarly **UniversalSearchBar**) use `usePlayback().playSource` and never `playSourceOrSend`.
2. In CONTROL mode, `deviceModeAllowsLocalPlayback.current` is false, so `playSource` returns without playing or sending any command.
3. `playSourceOrSend` correctly sends `PLAY_SOURCE` to MASTER when in CONTROL, but it is only wired to `SourceCard` (grid), not to search-result PLAY NOW buttons.

### Playlists only after refresh

1. **Sources page:** Server fetch only at page render; no refetch on create/update.
2. **Library page:** Single client fetch in `useEffect` on mount; no refetch triggers.
3. **No WebSocket event** (e.g. `LIBRARY_UPDATED`, `PLAYLIST_SAVED`) to trigger refetch.
4. **No shared cache** – each tab/device keeps its own list.

### MASTER and controller seeing different library

1. **MASTER** uses `initialSources` from server and/or `fetchUnifiedSourcesWithFallback()` at mount.
2. **Controller** in CONTROL mode uses the same fetch pattern but in its own tab/device.
3. When one client adds/removes a playlist, the other’s list is unchanged until reload or navigation.
4. No broadcast or invalidation mechanism exists for library changes.

---

## 5. Safest Implementation Plan

### Phase A: Make PLAY NOW truly play

**Scope:** Minimal change so PLAY NOW sends the right command when in CONTROL.

1. In `LibraryInputArea` and `UniversalSearchBar`, obtain `playSourceOrSend` when in device/control mode (e.g. from `useDevicePlayer()`).
2. Use `playSourceOrSend ?? playSource` for PLAY NOW handlers instead of raw `playSource`.
3. Alternatively, pass `playSourceOverride` from `SourcesManager` into `LibraryInputArea` (same pattern as `SourceCard`).

**Avoid:**

- Changing PlaybackProvider or playback engine logic.
- Broad refactors of search or device logic.

**Files likely to change:**

- `components/library-input-area.tsx`
- `components/universal-search-bar.tsx` (if it has PLAY NOW)
- `components/sources-manager.tsx` (to pass override into search)

---

### Phase B: Live playlist / library sync

**Scope:** Library changes propagated across clients without reload.

**Option 1 – WebSocket broadcast (recommended):**

1. Add a new message type, e.g. `LIBRARY_UPDATED` or `PLAYLIST_CHANGED`.
2. When `/api/playlists` or `/api/radio` create/update/delete, notify the WS server (or emit from API route).
3. Server broadcasts `LIBRARY_UPDATED` to all connected clients in the branch/session.
4. Clients listening for it call `fetchUnifiedSourcesWithFallback()` (or equivalent) to refresh.

**Option 2 – Polling / visibility refetch:**

1. Refetch sources when tab becomes visible (`document.visibilitychange`).
2. Or poll every N seconds (simpler, less real-time).

**Files likely to change:**

- `lib/remote-control/types.ts` – new message type
- `server/index.ts` – handle and broadcast library update events
- `lib/remote-control/ws-client.ts` – handle `LIBRARY_UPDATED`
- `components/sources-manager.tsx` – subscribe and refetch
- `app/(app)/library/page.tsx` – subscribe and refetch
- API routes for playlists/radio – trigger broadcast after mutations

---

### Phase C: Clean event / result contract for future clients

**Scope:** Stable API for mobile, WED, WhatsApp, Telegram, etc.

1. Document WebSocket events: `COMMAND`, `STATE_UPDATE`, `DEVICE_LIST`, `LIBRARY_UPDATED`.
2. Define `PlaySourcePayload` and any new payloads for library/source events.
3. Document which commands trigger which events.
4. Optional: REST webhooks or server-sent events for non-WS clients.

---

## 6. Relevant Files

### Internet search result actions

| File | Role |
|------|------|
| `components/library-input-area.tsx` | Search, PLAY NOW, Add for YouTube/Radio – uses `playSource` only |
| `components/universal-search-bar.tsx` | Same pattern, used in some layouts |
| `components/mobile-search-bar.tsx` | Mobile search, similar handlers |
| `components/ai-search-bar.tsx` | AI search |
| `components/radio-search-bar.tsx` | Radio search |
| `lib/search-service.ts` | `searchAll`, `searchExternal` |

### PLAY NOW handler

| File | Role |
|------|------|
| `components/library-input-area.tsx` | `handlePlayYoutube`, `handlePlayRadio` |
| `components/universal-search-bar.tsx` | Same |
| `lib/playback-provider.tsx` | `playSource` – guarded by `deviceModeAllowsLocalPlayback` |
| `lib/device-player-context.tsx` | `playSourceOrSend` – not used by search |

### Playlist create / update

| File | Role |
|------|------|
| `components/library-input-area.tsx` | `createPlaylistFromUrl`, POST `/api/playlists` |
| `app/api/playlists/route.ts` | Create playlist |
| `app/api/radio/route.ts` | Create radio station |
| `lib/unified-sources-client.ts` | `savePlaylistToLocal`, `saveRadioToLocal` |

### Playlist rendering on MASTER

| File | Role |
|------|------|
| `app/(app)/sources/page.tsx` | Server fetch → `initialSources` |
| `components/sources-manager.tsx` | `effectiveSources`, `SourcesPlaybackProvider` |
| `components/source-card-unified.tsx` | Renders each source |
| `app/(app)/library/page.tsx` | Client fetch, grid of playlists |

### Playlist rendering on controller

| File | Role |
|------|------|
| Same as MASTER when on `/sources` or `/library` in CONTROL mode | No separate controller rendering path |

### WebSocket events (existing)

| File | Role |
|------|------|
| `lib/remote-control/types.ts` | `ClientMessage`, `ServerMessage`, `COMMAND`, `STATE_UPDATE`, `DEVICE_LIST` |
| `lib/remote-control/ws-client.ts` | Sends/receives WS messages |
| `server/index.ts` | Relays commands, broadcasts state |

### Missing events

- No `LIBRARY_UPDATED` / `PLAYLIST_CHANGED` / `SOURCE_ADDED`.
- No broadcast when playlists or radio stations are created/updated/deleted.
