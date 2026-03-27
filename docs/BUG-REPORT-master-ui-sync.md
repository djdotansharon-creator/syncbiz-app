# MASTER UI Sync Bug – Inspection Report

**Bug:** When a song/source is changed or saved through the controller, the MASTER starts playing the new track correctly, but the MASTER UI playlist/source display does not update live. Only after a browser refresh does the MASTER UI show the updated state. Refresh is not acceptable because it stops playback.

**Status:** Inspection only – no code changes made.

---

## 1. Current Data Flow

### When controller changes/saves a song/source

| Step | Component | Action |
|------|-----------|--------|
| 1 | Controller (remote page, owner page, station controller) | `sendCommand(masterDeviceId, "PLAY_SOURCE", { source: payload })` or `"LOAD_PLAYLIST"` |
| 2 | `useRemoteController` / `DevicePlayerContext.playSourceOrSend` | Sends `COMMAND` over WebSocket |
| 3 | `server/index.ts` | Relays `COMMAND` to MASTER device’s WebSocket |
| 4 | `lib/remote-control/ws-client.ts` | Receives `data.type === "COMMAND"` → `onCommandRef.current({ command, payload })` |
| 5 | `lib/device-player-context.tsx` | `onCommand` handles `PLAY_SOURCE`: `fetchUnifiedSourcesWithFallback()` → `playSource(full \|\| payloadToUnifiedSource(payload))` |
| 6 | `lib/playback-provider.tsx` | `playSource()` updates state: `currentSource`, `currentPlaylist`, `queue`, `queueIndex`, `status` |

### What state is updated on the MASTER

- **PlaybackProvider** (`lib/playback-provider.tsx`): `currentSource`, `queue`, `queueIndex`, `status` — all updated correctly.
- **AudioPlayer** (`components/audio-player.tsx`): Uses `usePlayback()` → receives updated `currentSource` → **updates**.
- **PlaybackBar** (`components/playback-bar.tsx`): Uses `usePlaybackOptional()` → receives updated `currentSource` → **updates**.

### What state is NOT updated on the MASTER UI

- **PlayerPage** (`components/player-page.tsx`): Does **not** use `usePlayback()`. Uses URL params (`sourceId`, `playlistId`) and local `source` state. When controller changes the source, the URL does not change → **stays stale**.
- **Sources / Library list**: Fetched once (server for sources, client `useEffect` for library). If the controller “saves” a new source/playlist, the MASTER list is not refetched → **new items do not appear**.

---

## 2. Root Cause

### Main issue: PlayerPage is URL-driven only

The MASTER `/player` page shows `PlayerPage`, which:

- Reads `sourceId` and `playlistId` from `useSearchParams()`.
- Fetches source/playlist in a `useEffect` when URL params change.
- Holds its own `source` in `useState` and never subscribes to `PlaybackProvider`.

**Result:** When the controller sends `PLAY_SOURCE`, the PlaybackProvider updates, but PlayerPage stays on the old source because the URL never changes.

### Secondary issue: list data only on mount

- **Sources page**: `initialSources` from server, passed at render.
- **Library page**: `useEffect` with `fetchUnifiedSourcesWithFallback()` runs once on mount.

When the controller saves a new source/playlist, no refetch or WebSocket event causes these lists to refresh, so new items are not shown until a full page reload.

---

## 3. Event / Data Flow Map

```
Controller                    Server                      MASTER Client
---------                    ------                      --------------
sendCommand("PLAY_SOURCE")    →  relay COMMAND             DevicePlayerProvider
                                    →  onCommand
                                         →  playSource(UnifiedSource)  [from usePlayback]
                                              →  PlaybackProvider.setState
                                                   ├── currentSource ✓
                                                   ├── queue ✓
                                                   └── status ✓

Consumers of usePlayback():
├── AudioPlayer         → updates ✓
├── PlaybackBar         → updates ✓
├── SourceCard (active) → updates ✓
└── PlayerPage          → NOT a consumer; uses URL only ✗
```

---

## 4. Relevant Files

| Area | File | Responsibility |
|------|------|----------------|
| Controller action | `lib/device-player-context.tsx` | `playSourceOrSend` → `sendCommandToMaster("PLAY_SOURCE", …)` |
| Controller action | `lib/station-controller-context.tsx` | `sendCommand(masterDeviceId, "PLAY_SOURCE", …)` |
| Server relay | `server/index.ts` | Forwards COMMAND to MASTER device WebSocket |
| WS receive | `lib/remote-control/ws-client.ts` | `onCommand` callback on COMMAND |
| Command handler | `lib/device-player-context.tsx` | `onCommand` → `playSource()` |
| Master playback update | `lib/playback-provider.tsx` | `playSource()` updates state |
| Master UI (updates) | `components/audio-player.tsx` | Uses `usePlayback()` ✓ |
| Master UI (updates) | `components/playback-bar.tsx` | Uses `usePlaybackOptional()` ✓ |
| Master UI (stale) | `components/player-page.tsx` | Uses URL params only, no `usePlayback()` ✗ |
| Master playlist/source grid | `components/source-card-unified.tsx` | Uses `usePlayback()` for active highlight ✓ |
| Master playlist/source list | `app/(app)/sources/page.tsx` | Server fetch, passed as `initialSources` |
| Master playlist/source list | `app/(app)/library/page.tsx` | Client fetch in `useEffect`, once on mount |

---

## 5. Safest Fix Plan

### Primary fix: sync PlayerPage with PlaybackProvider

**Goal:** When PlaybackProvider’s `currentSource` changes (including from remote commands), PlayerPage shows that source instead of the URL-derived one.

**Approach:** Use `usePlayback()` in PlayerPage and treat `currentSource` as the source of truth when present. Only fall back to URL-driven fetch when there is no `currentSource` and URL params exist.

**Suggested implementation:**

1. In `components/player-page.tsx`:
   - Import and use `usePlayback()` (or `usePlaybackOptional()`).
   - When `currentSource` exists, derive the displayed source from it (with a fallback when it’s not embeddable, e.g. external URLs).
   - When `currentSource` changes via remote command, update the displayed source and embed without changing the URL.
   - Preserve URL-based entry: if user lands on `/player?sourceId=xyz` with no current playback, keep fetching from the URL.

**Constraints:**

- Do not interrupt playback.
- Do not require a refresh.
- Keep existing playback behavior.
- Minimize changes; avoid broad refactors.

### Secondary fix (future): live list updates

When the controller saves a new source/playlist:

- Option A: Server broadcasts a “SOURCE_SAVED” or “PLAYLIST_SAVED” event; MASTER subscribes and refetches the relevant list.
- Option B: Refetch sources/playlists on a timer or when the tab regains focus (simpler, but less real-time).

---

## 6. Files Likely to Change (Primary Fix Only)

| File | Change |
|------|--------|
| `components/player-page.tsx` | Add `usePlayback()` / `usePlaybackOptional()`, derive displayed source from `currentSource` when present, keep URL as fallback for initial load |

**No changes needed to:**

- Playback engine / PlaybackProvider
- DevicePlayerContext / onCommand
- AudioPlayer / PlaybackBar
- Server or WebSocket layer
