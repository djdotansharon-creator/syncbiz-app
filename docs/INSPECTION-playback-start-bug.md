# Playback-Start Bug – Inspection Report

**Status:** Inspection only. No code changes made.

---

## 1. Current Play Flow

### MASTER (desktop with player role)

| Step | Component | Action |
|------|-----------|--------|
| 1 | `SourceCard` / `SourceRow` | User clicks Play → `playSourceFn(source)` |
| 2 | `playSourceFn` | `onPlaySourceProp ?? playSource` → on MASTER, `playSourceOverride` is `undefined`, so uses `playSource` from `usePlayback()` |
| 3 | `PlaybackProvider.playSource` | Guard: `if (!deviceModeAllowsLocalPlayback.current) return` |
| 4 | | `stopAllBeforePlay()` → `stopAllPlayersRef.current()` → `AudioPlayer.stopAllEmbedded()` (destroys YT/SC/audio) |
| 5 | | `setState({ currentSource, currentTrackIndex, status: "playing", queue, queueIndex })` |
| 6 | `AudioPlayer` | Reads `currentSource`, `currentPlayUrl`, `status`, `isEmbedded` from `usePlayback()` |
| 7 | | Effect `[isYouTube, isSoundCloud, loadYouTube, loadSoundCloud]` → calls `loadYouTube()` or `loadSoundCloud()` |
| 8 | | Effect `[status, isYouTube, isSoundCloud]` → when `status === "playing"`, calls `safePlayVideo(p)` or `scWidgetRef.current.play()` |
| 9 | | YT: `onReady` also calls `safePlayVideo(target)` if `statusRef.current === "playing"` |

### CONTROL (desktop controlling remote MASTER)

| Step | Component | Action |
|------|-----------|--------|
| 1 | `SourceCard` | `playSourceOverride` = `deviceCtx.playSourceOrSend` (when `isDevicePlayer && !isMaster`) |
| 2 | `playSourceOrSend` | `sendCommandToMaster("PLAY_SOURCE", { source })` → WebSocket to MASTER |
| 3 | MASTER `DevicePlayerProvider.onCommand` | Receives `PLAY_SOURCE`, calls `playSource(payloadToUnifiedSource(payload))` or `playSource(full)` from `fetchUnifiedSourcesWithFallback` |
| 4 | | Same flow as MASTER above from step 3 |

### Phone / Controller (mobile)

| Step | Component | Action |
|------|-----------|--------|
| 1 | **Controller mode** | `MobileSourceCard` → `sendPlaySource(source)` from `StationControllerProvider` |
| 2 | | Sends `PLAY_SOURCE` to MASTER via WS |
| 3 | MASTER | Same as CONTROL path – MASTER receives and runs `playSource` |
| 4 | **Player mode** | `MobileSourceCardLocal` → `playSource(source)` from `usePlayback()` |
| 5 | | Same as MASTER flow; `AudioPlayer` in minimal layout (fixed, `opacity-0`) |

---

## 2. Root Cause Analysis

### Primary: Status vs. embed readiness

- `playSource` sets `status: "playing"` immediately.
- The play effect (387–401) runs as soon as `status` changes and calls `safePlayVideo(p)` / `scWidgetRef.current.play()`.
- YT and SC players load asynchronously: `loadYouTube` / `loadSoundCloud` start creation; playback is intended to happen in `onReady` / `ready`.
- If `onReady` / `ready` never fires (e.g. script load failure, bad URL, container not ready), playback never starts even though `status === "playing"` and the UI shows “playing”.

### Secondary: SoundCloud `lastScEmbedUrlRef` guard

- `loadSoundCloud` has: `if (lastScEmbedUrlRef.current === scEmbedUrl) return;`
- `stopAllEmbedded` (called from `stopAllBeforePlay`) sets `scWidgetRef.current = null` but does **not** clear `lastScEmbedUrlRef`.
- The cleanup in the effect at 375–386 clears `lastScEmbedUrlRef` only when `currentPlayUrl` (or other deps) **change**.
- If the user selects the **same** SoundCloud source again, `currentPlayUrl` is unchanged → cleanup does not run → `lastScEmbedUrlRef` still equals `scEmbedUrl` → `loadSoundCloud` returns early without creating a new widget.
- Result: widget is gone, `loadSoundCloud` skips, nothing plays.

### Tertiary: `deviceModeAllowsLocalPlayback` during "connecting"

- `deviceModeAllowsLocalPlayback.current = !isActive || status === "disconnected" || (status === "connected" && deviceMode === "MASTER")`
- When `status === "connecting"`, this is false → `playSource` returns before `setState` → no state update, no playback.
- Possible on first load if user clicks before WebSocket connects. Selection could come from `masterState` on CONTROL, not from local `playSource`.
- Explains “sometimes no playback on first interaction.”

### Why refresh fixes it

1. Full remount: refs reset; YT/SC DOM and scripts start clean.
2. After refresh, WS is often `"disconnected"` briefly → `deviceModeAllowsLocalPlayback` is true → playback allowed.
3. Session restore (`loadPersistedPlayback`) runs `playSource` after `fetchUnifiedSourcesWithFallback`, in a state where the guard usually allows playback.
4. Fresh embed instances avoid issues from repeated load/destroy cycles.

---

## 3. Relevant Files

| File | Role |
|------|------|
| `lib/playback-provider.tsx` | `playSource`, `stopAllBeforePlay`, `currentPlayUrl`, `getPlayUrl`, `registerStopAllPlayers`, `deviceModeAllowsLocalPlayback` guard |
| `components/audio-player.tsx` | `loadYouTube`, `loadSoundCloud`, `stopAllEmbedded`, effect `[isYouTube, isSoundCloud, loadYouTube, loadSoundCloud]`, effect `[status, isYouTube, isSoundCloud]` (play/pause), effect `[currentPlayUrl]` (cleanup), `lastScEmbedUrlRef` |
| `lib/device-player-context.tsx` | `deviceModeAllowsLocalPlayback` assignment, `playSourceOrSend`, `onCommand` (PLAY_SOURCE handler) |
| `lib/device-mode-guard.ts` | `deviceModeAllowsLocalPlayback` ref |
| `components/source-card-unified.tsx` | `playSourceFn` = `onPlaySourceProp ?? playSource` |
| `components/sources-manager.tsx` | `playSourceOverride` = `playSourceOrSend` when CONTROL, passed to `SourceCard` and `LibraryInputArea` |
| `lib/station-controller-context.tsx` | `sendPlaySource` for mobile controller |
| `app/(app)/mobile/page.tsx` | `MobileControllerContent` (sendPlaySource), `MobilePlayerContent` (playSource) |
| `components/app-shell.tsx` | `AudioPlayer` placement (desktop header vs mobile minimal layout) |

---

## 4. Safest Fix Plan

### A. Fix SoundCloud same-source replay (high confidence)

- **Where:** `components/audio-player.tsx`
- **Change:** In `stopAllEmbedded`, add `lastScEmbedUrlRef.current = null`.
- **Effect:** Ensures `loadSoundCloud` is never skipped when the same SC URL is replayed after a stop/switch.
- **Risk:** Low.

### B. Ensure embed load/play coordination (medium confidence)

- **Where:** `components/audio-player.tsx`
- **Change:** After `loadYouTube` / `loadSoundCloud` create the player/widget, call play from the effect at 387–401. Relying on `onReady` alone is brittle.
- **Implementation:** Add `currentPlayUrl` (or `vid` / `scEmbedUrl`) to the play effect deps, or use a dedicated effect that runs when `status === "playing"` and either `isYtPlayerReady(ytPlayerRef.current)` or `scWidgetRef.current` is truthy, then explicitly calls play.
- **Risk:** Medium; needs care to avoid loops or double-play.

### C. Avoid blocking playback during "connecting" (if applicable)

- **Where:** `lib/device-player-context.tsx`
- **Change:** Treat `"connecting"` like `"disconnected"` for `deviceModeAllowsLocalPlayback`: allow local playback until we know we are CONTROL.
- **Example:** `deviceModeAllowsLocalPlayback.current = !isActive || status !== "connected" || (status === "connected" && deviceMode === "MASTER")`.
- **Risk:** Medium; could briefly allow playback on a device that will become CONTROL.

### D. Optional: force embed container remount on source change

- **Where:** `components/audio-player.tsx`
- **Change:** Add `key={currentPlayUrl ?? "none"}` to the YT/SC container div so React remounts it when the source changes.
- **Effect:** Guarantees a fresh DOM node for each new source, avoiding reuse bugs.
- **Risk:** Low.

### Recommended order

1. Apply A (SoundCloud `lastScEmbedUrlRef`).
2. Apply D (container `key`) as a simple hardening step.
3. If the bug persists, apply B (load/play coordination).
4. Consider C only if the issue clearly happens on first interaction before WS connects.

---

## 5. Library Refresh vs. Playback Start

- Library refresh: “New sources only appear after refresh” – about source list caching and lack of WebSocket/library invalidation.
- Playback start: “Selecting a source does not start playback until refresh” – about playback state, embed loading, and play coordination.
- These are separate concerns:
  - Library: `effectiveSources`, `fetchUnifiedSourcesWithFallback()`, no `LIBRARY_UPDATED` WS event.
  - Playback: `currentSource`, `currentPlayUrl`, `loadYouTube`/`loadSoundCloud`, `status`, `deviceModeAllowsLocalPlayback`.
- They can overlap in UX: a newly added source might be missing from the list and therefore not playable until refresh. But once a source is visible and selected, the playback-start bug is independent of library sync.
