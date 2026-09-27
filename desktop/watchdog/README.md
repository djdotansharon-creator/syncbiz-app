# VONO Watchdog (external Core Protection) — POC

Independent, offline-safe process that keeps a branch VONO station playing. See the full design in
[`docs/VONO_CORE_PROTECTION.md`](../../docs/VONO_CORE_PROTECTION.md).

**This folder is PR-B: a READ-ONLY observer.** It reads the app's heartbeat, computes the watchdog
state machine, and logs what it *would* do. It executes **no** recovery and spawns **nothing** yet
(recovery = PR-C). It is not bundled into the Electron app (`desktop/tsconfig*.json` compile only
`src/**`), does not touch playback code, and has no network dependency.

## Files
- `contract.ts` — **re-exports** the single source-of-truth schema from
  `desktop/src/shared/vono-runtime-state.ts` (heartbeat + control + `WatchdogState`/`RecoveryAction`,
  landed by PR-A, now in main) and adds only the watchdog's operational thresholds (`WD`). No schema
  copy, so there is zero drift between the writer (app) and the reader (watchdog).
- `state-machine.ts` — **pure** `deriveState()` (detection) + `decide()` (recovery/anti-loop) + the
  per-attempt `ProgressTracker` (`observeProgress`). No I/O.
- `observer.ts` — read-only loop: reads `C:\ProgramData\VONO\state\{heartbeat,control}.json`, probes
  the VONO PID (signal 0), logs transitions to `C:\ProgramData\VONO\logs\watchdog.log`. The loop timer
  is **not** `unref()`'d, so the process stays alive 24/7 until an explicit shutdown.
- `self-check.ts` — synthetic scenarios proving the 7 states + anti-loop + startup-safety (A–D) +
  process-lifetime (E), no live box needed.
- `tsconfig.json` — standalone typecheck (`tsc --noEmit -p desktop/watchdog/tsconfig.json`).

## Try it
```bash
npx tsc --noEmit -p desktop/watchdog/tsconfig.json   # typecheck
npx tsx desktop/watchdog/self-check.ts               # print state-machine transitions
# npx tsx desktop/watchdog/observer.ts               # read-only observe loop (needs heartbeat writer / PR-A)
```

## States (see design §C)
`HEALTHY · APP_MISSING · RENDERER_STALE · MPV_DOWN · PLAYBACK_STALLED · RECOVERING · MAINTENANCE`
Precedence: MAINTENANCE > RECOVERING > APP_MISSING > MPV_DOWN > PLAYBACK_STALLED > RENDERER_STALE >
HEALTHY. Thresholds are looser than the app's own self-heal so the two never fight.
