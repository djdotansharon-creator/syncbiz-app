# Playback-Start Bug – Deep Inspection (Post-Embed Fixes)

**Status:** Inspection only. No code changes made.

**Context:** Previous fixes (lastScEmbedUrlRef in stopAllEmbedded, key remount on currentPlayUrl) did not resolve the bug. Playback still does not start on source selection; refresh fixes it.

---

## 1. Exact Runtime Sequence

### YouTube

| Step | Event | State / Action |
|------|-------|----------------|
| 1 | User clicks source | `playSource(source)` → `stopAllBeforePlay()` → `setState({ currentSource, status: "playing" })` |
| 2 | React batches, re-renders | AudioPlayer receives new `currentSource`, `currentPlayUrl`, `status` |
| 3 | Effect 375–386 cleanup | Runs (currentPlayUrl changed) → `stopAllEmbedded()` |
| 4 | Effect 278–281 | `loadYouTube()` called |
| 5 | loadYouTube | `new YT.Player(ytContainerRef.current, { ..., events: { onReady } })` – returns immediately, iframe loads async |
| 6 | Effect 387–401 | Runs; `ytPlayerRef.current` is null → `isYtPlayerReady(p)` false → no `safePlayVideo` |
| 7 | (async) | YT iframe loads, player initializes |
| 8 | (async) | `onReady(evt)` fires |
| 9 | onReady | `ytPlayerRef.current = target`; if `statusRef.current === "playing"` → `safePlayVideo(target)` |

**Chain break:** If step 8 never happens or happens after a conflicting update, playback never starts. There is no retry from the play effect.

### SoundCloud

| Step | Event | State / Action |
|------|-------|----------------|
| 1 | User clicks source | Same as YT – `playSource` → `setState` |
| 2 | Re-render | `currentPlayUrl`, `scEmbedUrl` |
| 3 | Effect 375–386 cleanup | `stopAllEmbedded()`, `lastScEmbedUrlRef = null` |
| 4 | Effect 278–281 | `loadSoundCloud()` |
| 5 | loadSoundCloud | `widget = SC.Widget(scIframeRef.current)`, `widget.bind("ready", cb)` |
| 6 | Effect 387–401 | `scWidgetRef.current` may exist but widget may not be ready; `widget.play()` may no-op or fail |
| 7 | (async) | SC player in iframe loads |
| 8 | (async) | `ready` event fires |
| 9 | ready callback | if `statusRef.current === "playing"` → `widget.play()` |

**Chain break:** Same as YT – if `ready` never fires, or fires after the widget/iframe is invalidated, play is never attempted. There is no retry from the play effect.

---

## 2. Root Cause

### Is play attempted before the player is ready?

**Yes.** The play effect (387–401) runs right after the load effect. At that moment:

- **YT:** `ytPlayerRef.current` is still null (onReady has not run).
- **SC:** `scWidgetRef.current` may be set, but the widget may not be ready; calling `play()` too early can be ignored.

So the play effect almost always tries to play before the embed is ready and cannot succeed.

### If ready fires later, is play retried or lost forever?

**Play is retried only in the ready callbacks.** If `onReady` (YT) or `ready` (SC) fire and `statusRef.current === "playing"`, we call play there. There is no other retry path. If those callbacks never run, or run in a bad state, playback is never started.

### Is there a race between status="playing" and embed readiness?

**Yes.** `status` is set to `"playing"` immediately. The embed loads asynchronously. The play effect runs synchronously in the same effect batch and sees a not-ready player. The only path to play is the ready callback. The race is: ready must fire before anything invalidates the player (remount, cleanup, etc.).

### Is there any stale flag/ref preventing retry?

- **YT:** `currentVidRef.current !== vid` in onReady – if we switched sources before ready, we bail. Correct.
- **SC:** `lastScEmbedUrlRef.current !== scEmbedUrl` in ready – same idea. Correct.
- The play effect never reruns for “player just became ready” because its deps are `[status, isYouTube, isSoundCloud]`. Refs do not trigger re-renders.

### Is the problem worse for YT, SC, or both?

**Both are vulnerable.** The same pattern applies: play effect runs too early; only ready callbacks can start playback. Extra risks:

- **YT:** Script load (`onYouTubeIframeAPIReady`) and effect/remount ordering can delay or drop `onReady`.
- **SC:** Widget `ready` can be missed if the widget becomes ready before we bind (e.g. cached iframe). Known SC Widget timing issues also suggest ready may be unreliable.

---

## 3. Why Refresh Fixes It

On refresh:

1. Full remount – no old players, no leftover cleanup or Strict Mode double-mount races.
2. Single linear flow – mount → load effect → create embed → ready fires.
3. No quick source switching or state churn that could invalidate the embed before ready.
4. Persisted playback: `loadPersistedPlayback` calls `playSource` after fetch; by then the page and WS are stable.

So refresh removes timing races and stale state that can prevent ready callbacks from firing or from running in a valid context.

---

## 4. Relevant Files & Code Paths

| File | Functions / Effects | Role |
|------|--------------------|------|
| `lib/playback-provider.tsx` | `playSource` | Sets `currentSource`, `status: "playing"` |
| `components/audio-player.tsx` | Effect 278–281 | Calls `loadYouTube` / `loadSoundCloud` |
| | `loadYouTube` (196–237) | Creates `YT.Player`, `onReady` sets ref and calls `safePlayVideo` if status is playing |
| | `loadSoundCloud` (240–278) | Creates widget, `bind("ready", ...)` calls `widget.play()` if status is playing |
| | Effect 387–401 | Tries to play based on `status`; no player yet → no-op |
| | Effect 375–386 | Cleanup on `currentPlayUrl`; runs `stopAllEmbedded` |
| `lib/yt-player-utils.ts` | `safePlayVideo`, `isYtPlayerReady` | Safe YT API calls |

Missing pieces:

- No play retry when the player becomes ready after the play effect has run.
- No state that signals “player is ready” to the play effect.
- No fallback if `onReady` / `ready` never fire.

---

## 5. Safest Implementation Plan

### Preferred: `embedReady` state + play effect retry

Add a small “player is ready” signal so the play effect can retry when the embed loads.

1. **State:** `embedReady` (boolean), default `false`, reset when `currentPlayUrl` changes.
2. **In onReady (YT):** After `ytPlayerRef.current = target`, call `setEmbedReady(true)`.
3. **In ready (SC):** After binding, call `setEmbedReady(true)`.
4. **Reset:** In the effect that runs on `currentPlayUrl` (e.g. 285–289), add `setEmbedReady(false)` when the URL changes.
5. **Play effect:** Extend deps to `[status, isYouTube, isSoundCloud, embedReady]`. When `embedReady` becomes true and `status === "playing"`, call play.

This gives:

- Play attempt when `status` first becomes `"playing"` (usually too early; no-op).
- Second attempt when `embedReady` flips to true and player refs are valid.

### Alternative: Only set `embedReady` in ready callbacks

Skip polling or timers. Rely on ready callbacks to set `embedReady` when the embed is truly ready. The play effect then reacts to both `status` and `embedReady`.

### Scope

- Only in `components/audio-player.tsx`.
- Add `embedReady` state and its reset.
- Update `onReady` / `ready` to set it.
- Extend play effect deps to include `embedReady`.

### What not to change

- No changes to PlaybackProvider or playback flow.
- No changes to load effect or load functions beyond setting `embedReady`.
- No changes to cleanup or key remount.

---

## 6. Files Likely to Change

| File | Changes |
|------|---------|
| `components/audio-player.tsx` | Add `embedReady` state, reset on `currentPlayUrl` change, set in onReady/ready, include in play effect deps |
