# P0 PLAYBACK HARDENING — RUNTIME ACCEPTANCE (2026-10-07)

> Status: **ACCEPTED — owner-attested 2026-10-07** (Dotan, Lenovo pilot station, beta.12 + TEST renderer).
> This Claude session ran on the Dev-PC (`dsk-9b11bfa1-…`) and did **not** inspect Lenovo-local logs; the runtime
> result is owner-attested (CLAUDE.md §6). Server-side facts below are labeled where independently verified.
> Environment: **TEST only** (Railway `syncbiz-pr52-test`). **PROD untouched.**
> Branch: `feature/control-room-phase1` (pushed). PR #52 untouched / frozen.
> After this lock, **no playback code changes without a new isolated gate** (AUDIT → approval → isolated commit →
> tests → TEST → runtime acceptance).

## 1. Accepted build

| Item | Value |
|---|---|
| Desktop installer | `SyncBiz-Player-Setup-2.2.8-beta.12-x64.exe` |
| Version | `2.2.8-beta.12` |
| SHA256 | `3becd1c881c6c847f11c0c10f2f1549c7987be92bb1e83808b36cf8528e49429` |
| Size | 140,772,149 bytes · unsigned · **NOT published** · TEST-pinned |
| Desktop source lineage | `dc744575e97279358e6794687ed37d408706677d` + transient TEST pins (reverted after build): `desktop/src/main/hosted-url.ts` → TEST app + TEST WS; `normalizeEndpointsForPackaged` → force TEST endpoints on every packaged load; `desktop/package.json` version → `2.2.8-beta.12` |
| Packaged asar check | version beta.12; TEST app/WS hosts only (single PROD host = a comment line); `nextMainWsAttemptId`, `standbyLoadTimeoutMs`, `isCrossfadeIncomingReady`, `core-idle` / `paused-for-cache` observers and the XFADE main.log trace compiled; packaged watchdog bundle byte-identical to the fresh build |
| Accepted artifact copy | `D:\SyncBiz_Backups\pilot\2026-10-07-beta12-p0-accepted\` (hash re-verified `OK`); candidate copy `D:\SyncBiz_Backups\pilot\2026-10-07-beta12-dc74457\` |
| Renderer (TEST app) | source `3d6a70de92e54e88ba00e2f7f14dc6589e5cf644`; Railway deployment `a1028a7f-98f2-4a5f-9a82-fb47f35f03f7` (SUCCESS 2026-10-06 23:49 +03:00). **Server-verified 2026-10-07 (read-only `railway ssh`):** live `lib/device-player-context.tsx`, `lib/station-transport-routing.ts`, `components/sources-manager.tsx` hash-identical to `3d6a70d`. No renderer/app/server source changed after `3d6a70d` (only `desktop/**` + a test scope pin). Exact commit-to-deploy linkage not cryptographically proven (Railway has no commit hash). |
| WS (TEST) | unchanged by this P0 (no WS protocol change) |
| DB | unchanged (no schema / data change) |

**Accepted commits** (all pushed to `origin/feature/control-room-phase1`):

| Commit | Class | Content |
|---|---|---|
| `e78e8a0bbd3410a456b8f0120a131581918f65e0` | RENDERER ONLY | LOCAL→URL session / transport coherence; correct URL trackIndex |
| `3d6a70de92e54e88ba00e2f7f14dc6589e5cf644` | test only | P0 test loads the desktop MAIN module dynamically (app build host has no electron) |
| `2e5b4b8343a219f755956a8888d8161ee433937d` | DESKTOP MAIN + WATCHDOG | fresh MAIN attemptId per WS load; shared stall predicate; 120 s startup hard max; kill cancellation; source-aware standby load windows |
| `dc744575e97279358e6794687ed37d408706677d` | DESKTOP MAIN | crossfade readiness: stream incoming deck must show real MPV progress; promotion normalization; main.log XFADE trace |

Intermediate candidate (superseded, not accepted on its own): `2.2.8-beta.11` from `2e5b4b8`, SHA256
`e4547ea7ee020a636032574498233fda05c1dc86b10f8318e0be9b0dc3716fbf`, kept at
`D:\SyncBiz_Backups\pilot\2026-10-07-beta11-2e5b4b8\`.

## 2. Root causes and fixes

### A. Wrong URL item / LOCAL contamination of a URL session (`e78e8a0`, RENDERER ONLY)
- **Root cause (PROVEN BY CODE + test reproduction):** expanding a SyncBiz playlist item for URL playback sent
  PLAY_SOURCE without the item's trackIndex (defaulted to 0) → MAIN's session metadata pointed at the first
  item → wrong title/item. On the designated station, NEXT/PREV during a URL session still executed against the
  local provider queue (the routing ignored who owned the session) → LOCAL items leaked into the URL session.
- **Fix:** `playSyncbizPlaylistExpandedItem` computes the index first and passes it on all three branches;
  `routeStationTransport` / `transportRunsLocally()` (`lib/station-transport-routing.ts`) runs transport locally
  only for MASTER-mode transport or a designated station whose current LOCAL session it OWNS; URL NEXT/PREV send
  PLAY_SOURCE N±1 (`stepUrlSession`).

### B. Watchdog killed slow URL resolution (`2e5b4b8`, DESKTOP MAIN + WATCHDOG)
- **Root cause (PROVEN BY CODE + test reproduction):** every WS-initiated MAIN load used the orchestrator default
  attemptId `0`. The watchdog resets its per-attempt progress history only when the heartbeat attemptId changes,
  so a fresh URL still resolving through yt-dlp (pos 0 / dur 0) was judged a frozen *old* attempt and declared
  PLAYBACK_STALLED after ~12–13 s → recovery kill → VONO restart (explains the 2026-10-06 URL→LOCAL drop). The
  recovery `isAppHealthy` abort used a cruder predicate than `deriveState`, so a kill could proceed after health
  returned.
- **Fix:** `nextMainWsAttemptId()` (unique ids ≥ 1,000,000,001) on every WS load path; one shared
  `evaluatePlaybackStall` used by `deriveState` AND the kill abort (live progress tracker); a never-progressing
  attempt is stuck only after `startupHardMaxMs` = 120 s; a fresh attempt or resumed progress during the kill
  grace → `aborted_healthy`.
- **Standby (crossfade) load windows, source-aware:** LOCAL 12 s · plain stream 30 s · yt-dlp source
  (YouTube / SoundCloud) 90 s; timeout aborts the crossfade and keeps the current track.

### C. Crossfade faded out audible audio while the incoming URL was still buffering (`dc74457`, DESKTOP MAIN)
- **Root cause (PROVEN BY CODE + test reproduction):** the A/B ramp started when the standby deck reported
  `status === "playing"` and `(duration > 0 || position > 0)`. MPV reports "playing" on start-file and a URL /
  yt-dlp source can know its duration while still core-idle / paused-for-cache → the audible deck was faded out
  and stopped before the incoming deck produced audio.
- **Fix (local to the crossfade path; global MPV `status` semantics unchanged):** MpvManager exposes additive
  readiness signals (`coreIdle`, `pausedForCache`, `positionAt`, `progressObserved`, `fileLoaded`). A STREAM
  incoming deck is ready only when playing ∧ ¬coreIdle ∧ ¬pausedForCache ∧ a real MPV `time-pos` advance was
  observed for this load (`desktop/src/main/crossfade-readiness.ts`). LOCAL keeps the legacy fast rule.
  `finishXfadeSwap` re-asserts target volume + `pause=false` on the promoted deck. Change-only `XFADE_*` lines in
  `main.log`.

## 3. Lenovo runtime evidence — ACCEPTED, owner-attested 2026-10-07 (beta.12)

Correct URL trackIndex · URL NEXT/PREV queue coherence · no LOCAL contamination during a URL session · fresh MAIN
attemptId per WS load · watchdog does not falsely restart during slow URL resolution · recovery kill cancellation ·
source-aware URL load timeouts · crossfade does not start on duration alone · stream crossfade waits for real MPV
progress · coreIdle / pausedForCache readiness gating · outgoing audio stays audible during long URL buffering ·
promotion volume + pause normalization · URL → LOCAL · LOCAL NEXT after URL · LOCAL automatic transition ·
**no playback gap · no watchdog restart · no force kill.**

## 4. Static / automated evidence (PROVEN BY TEST, Dev-PC)

`verify-p0-crossfade-readiness` 27/27 · `verify-p0-watchdog-url-load` 25/25 · watchdog self-check 68 PASS / 0 FAIL ·
`verify-p0-local-url-queue-split` 31/31 · `verify-attempt-mode` 24/24 (test G updated: the correlated stream event
carries readiness evidence; invariant unchanged) · all other desktop suites and the app/server suites touching
desktop PASS · desktop + watchdog tsc clean · app/server tsc + `next build` PASS.

## 5. Rollback

| Layer | Reference |
|---|---|
| This baseline (desktop) | tag `pilot-baseline/2026-10-07-desktop-beta12-dc74457` → `dc74457`; artifact `D:\SyncBiz_Backups\pilot\2026-10-07-beta12-p0-accepted\` (SHA256 above) |
| This baseline (renderer) | tag `pilot-baseline/2026-10-07-renderer-3d6a70d` → `3d6a70d`; TEST deployment `a1028a7f-98f2-4a5f-9a82-fb47f35f03f7` |
| Previous accepted desktop | beta.10, tag `pilot-baseline/2026-10-05-desktop-beta10-cd4c631`, artifact `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-accepted\` (SHA256 `0e292ec1…f9b0`) — rolling back loses all three P0 fixes |

The source tag does NOT reproduce the binary by itself (transient TEST pins) — restore the Lenovo from the preserved
installer, verified by hash.

## 6. Known remaining NON-P0 items (PARKED — each its own gate)

1. **URL STARTUP LATENCY (performance).** Observed ~15–76 s from command to audio for some yt-dlp URLs on the
   Lenovo. Continuity is protected (outgoing audio keeps playing; no watchdog restart), so it is now a performance
   item, not a playback-continuity P0. Not addressed in this lock.
2. **URL natural EOF auto-advance** — MAIN does not auto-advance a URL session at natural EOF.
3. **External controller ownership release** — another controller switching MAIN to a source does not release the
   Lenovo renderer's session ownership.
4. **yt-dlp `_MEI*` temp-folder cleanup** — leftover PyInstaller extraction folders from yt-dlp runs.
5. **Excessive schedules polling** (baseline §9 item 14).
6. **Fullscreen modal visibility** (baseline §9 item 12).
7. **Existing-user invite acceptance / consent flow** (baseline §9 item 13).
8. Known residual from the watchdog audit: if MAIN's MPV engine fails while its mock status still says
   "playing", the 120 s startup hard max (not the 12 s stall) is what triggers recovery.
