# VONO Core Protection — P0 Design (external Watchdog) + Fleet Protect contract

Status: **DESIGN / POC** on branch `feat/vono-core-protection-design`. No merge, no deploy, no
installer. Does not touch playback code. Supersedes the stale memory note that claimed Heartbeat
PR #21 was merged — **PR #21 is NOT in main** (see §A).

> Product intent: VONO Core Protection ships **in the product, default ON**. An external, independent
> process keeps a branch station playing. It watches APP + RENDERER + MPV + real PLAYBACK PROGRESS,
> recovers/restarts VONO when needed, starts on Windows boot and launches VONO, and **never lets
> internet loss stop local playback**. Fleet Protect (later) adds cloud visibility for 50→300 branches.

---

## 0. Ownership & responsibility boundaries (decision)

The VONO Watchdog is an **external local process**, but it is a **built-in part of the VONO product**
(shipped in the installer, default ON) — not a separate tool and not an optional add-on.

**Layered responsibilities — each layer owns exactly one job:**

| Layer | Owns | Does NOT do |
|---|---|---|
| **Local Watchdog** (this design) | local protection + local health state: keep VONO alive, detect APP/RENDERER/MPV/PLAYBACK failure, recover/restart, report health | never selects, schedules, or plays content; never runs campaigns/ads/jingles; never touches the MASTER lease |
| **VONO Cloud** (Fleet Protect / Control Room) | fleet visibility, telemetry aggregation, alerts, and **commands** (incl. campaign/ad/jingle scheduling + targeting) | never runs playback itself; never recovers a box directly (it asks; the box acts) |
| **Branch MASTER** (existing app) | executes playback and `PLAY_INTERRUPT` (ads/jingles/campaigns) locally | not responsible for its own process resurrection (that's the Watchdog) |

**Critical rule:** remote campaigns / ads / jingles are **NOT executed by the Watchdog**. They flow
**Control Room → VONO Cloud → branch MASTER**, and the MASTER performs the actual playback /
`PLAY_INTERRUPT`. The Watchdog only ensures the MASTER process is alive to receive them.

**Future campaign design must support (documentation only — NOT in scope here):**
- **Targeting hierarchy:** global / country / region / group / branch.
- **Scheduled playback:** time-windowed ad/jingle campaigns.
- **Pre-download to local cache:** a scheduled ad must still fire during an **internet outage** — the
  MASTER plays it from local cache; the schedule is resolved locally once the campaign + assets have
  been synced. (Aligns with the offline/Music-Bank keep-offline model.)

Fleet Protect and Campaigns are **not implemented in PR #27** (read-only observer only). This section
is the boundary of record so later PRs (PR-F fleet telemetry, and a separate Campaigns track) stay in
their lane.

---

## A. Current heartbeat audit (PR #21 vs current main)

**Location of PR #21:** commit `4e95730` on branch `feat/desktop-heartbeat-writer` (also on origin).
`git merge-base --is-ancestor 4e95730 main` → **NO**. The files do **not** exist in main:
`desktop/src/main/heartbeat-writer.ts`, `desktop/src/main/vono-paths.ts`,
`desktop/src/shared/vono-runtime-state.ts`. Main only has a 188-byte stub `desktop/src/watchdog/index.ts`.

### What still applies (keep as-is on rebase)
- **Contract `vono-runtime-state.ts`** — excellent, forward-compatible. Separates all four signals
  (APP / RENDERER / MPV / PLAYBACK) as raw facts and lets the reader derive states; `intervalMs`
  written into the file so the reader derives staleness = k×intervalMs; `renderer` + `bootId` reserved
  as `null`; `VonoControlState` already models maintenance with `reason/createdAt/expiresAt/bootId`
  and self-expiry. Adopt verbatim as the shared contract (§7).
- **`vono-paths.ts`** — `C:\ProgramData\VONO\state` root, atomic dir create, non-Windows temp
  fallback for dev. Matches §7. Keep.
- **`heartbeat-writer.ts`** — atomic tmp+rename write, ~1×/s coalescing, fixed 5s beat + prompt write
  on MPV transitions, `positionAt` stamped only when position changes (stall detection). Keep.

### Conflicts / drift vs current main (must fix on rebase)
1. **`ipc-mvp.ts` now registers `manager.onStatus(...)` in 5 places** (line 167 plus 231/249/262/274,
   added for config-patch manager re-creation). PR #21 fed `updateFromMpv(s)` only at line 167. On a
   naive rebase the heartbeat would **go stale after any config patch** (new manager, unfed writer).
   **Fix:** feed the heartbeat from a single chokepoint — either wrap the `onStatus` callback in one
   named function reused at all registration sites, or call `updateFromMpv` inside `broadcast(...)`
   (the one function every path already calls). Prefer the `broadcast` chokepoint: one line, no
   registration can bypass it.
2. **`index.ts` line shift only** — `registerMvpIpc` (476), `app.whenReady` (419), `before-quit`
   (501/515) all still exist; PR #21's `startHeartbeat` (after registerMvpIpc) and `stopHeartbeat`
   (both before-quit branches) re-place cleanly. No semantic conflict.
3. **Snapshot fields verified present** in main's `MvpStatusSnapshot`: `deviceId`, `branchId`,
   `mockPlaybackStatus`, `mpvEngineReady`, `mpvAttemptId` (+ `mpvPosition/Duration/LastError`). The
   writer compiles against current main. Re-confirm exact `mpv*` position/duration/lastError names on
   rebase.
4. **RC3 correlation now in main** (`e3e6769`): mpv-manager emits `MPV_LOADFILE`/`MPV_STARTFILE` to
   `main.log`. The watchdog log path (§7) should live under `…\VONO\logs\` to avoid mixing with the
   app's `main.log`.

**Recommendation:** do NOT merge PR #21 as-is. Re-land it as **PR-A** (rebased onto main, single
heartbeat chokepoint in `broadcast`). Everything else in this doc builds on that.

---

## B. Recommended Windows watchdog architecture

**Decision (see §5 for the trade-off): a user-session Watchdog process launched by a Scheduled Task
at logon + a boot-time auto-logon, NOT a Windows Service.** Rationale: VONO is a GUI Electron app; a
Service in Session 0 cannot launch or interact with the interactive desktop (Session 0 isolation), so
a Service would need a fragile helper to cross into the user session anyway. A user-session watchdog
launches and supervises a GUI app natively.

```
Windows boot
  → auto-logon (dedicated kiosk user)            [OS config, set once at provisioning]
  → Scheduled Task "VONO Protection" (at logon, highest privileges, restart-on-fail)
     → vono-watchdog.exe   (independent Node/pkg process; NOT bundled inside app.asar)
        • reads   C:\ProgramData\VONO\state\heartbeat.json   (written by VONO main)
        • reads   C:\ProgramData\VONO\state\control.json     (maintenance; self-expiring)
        • writes  C:\ProgramData\VONO\logs\watchdog.log      (+ restart history)
        • launches / relaunches "SyncBiz Player.exe" per the state machine (§C)
        • offline-safe: pure local file + process supervision, zero network dependency
  → VONO desktop starts, begins writing heartbeat
```

- **Independence:** the watchdog is a separate binary/process with its own lifecycle. If VONO
  crashes, the watchdog survives; if the watchdog dies, the Scheduled Task restarts it.
- **Offline:** every protection decision is local (files + process handles). Internet loss changes
  nothing in the local loop; only Fleet telemetry (§G) is deferred/queued when offline.
- **Single owner:** exactly one watchdog per box. It supervises exactly one VONO install path.

### Zero-touch cold-boot (audit) — Scheduled Task is necessary but NOT sufficient
Requirement: power loss → boot → station session available automatically → watchdog → VONO → MASTER
resumes, **with nobody present**. This needs three layers; the Scheduled Task is only the third:

1. **BIOS "After AC Power Loss = Power On"** (ThinkCentre M93P firmware). Without it, after a mains
   outage the box stays **off** and nothing runs. Firmware-level; not settable from the app.
2. **Windows autologin for a dedicated station account.** A "run at logon" task needs a logon to
   occur, and a GUI Electron app needs an interactive session — neither exists on a cold boot unless
   autologin is configured. **This is the linchpin.** Recommended: a dedicated **local, non-admin**
   `vono-station` account, autologin set via Sysinternals **Autologon.exe** (stores the password as an
   **LSA secret**, not the plaintext `Winlogon\DefaultPassword` registry value). Also: TPM-only
   BitLocker (no boot PIN), disable lock screen / sleep / screensaver, set power plan to never sleep,
   and defer Windows Update auto-reboots outside business hours.
3. **Scheduled Task at logon** (highest privileges, restart-on-failure) → watchdog → VONO.

**A Windows Service does NOT remove the autologin requirement** — Session 0 cannot host the GUI, so
even a Service would need an autologin'd interactive session to launch VONO. Autologin is unavoidable
for a GUI app; therefore the user-session Scheduled Task (on top of autologin + BIOS auto-power-on) is
the right POC and a defensible pilot design. Scheduled Task = POC choice, re-evaluated at scale, but
the autologin + BIOS prerequisites are inherent to any approach that runs a GUI player unattended.

Related gotchas to verify on the Lenovo: BitLocker boot PIN, Windows Update forced reboots, and the
`RECOVERY_TTL_MS` 24h cap (a station off > 24h will not auto-resume — separate P0 follow-up).

### MASTER-safety (identity)
Org → Branch → Device → MASTER. The pinned Lenovo stays the **preferred MASTER**; a second desktop
must never steal MASTER. The watchdog is **playback-agnostic** — it restarts the local VONO process
but never touches the WS MASTER lease. MASTER election stays where it is today (server lease, 90s
grace). The watchdog only ensures the *pinned* device's VONO is alive; lease ownership remains the
server's job. (Future: the watchdog may read `branchId/deviceId` from heartbeat to refuse
auto-relaunch on a non-pinned device, but that is not P0.)

---

## C. Watchdog state machine

Reader derives state each tick (default tick = 2s) from `heartbeat.json` + `control.json` + `now`.
Let `HB_INTERVAL = heartbeat.intervalMs` (5000).

| State | Detection signal | Threshold | Recovery action | Retry limit | Cooldown | Escalation / logging |
|---|---|---|---|---|---|---|
| **HEALTHY** | file fresh; app.alive; mpv.engineReady; if status=="playing" then position advancing (positionAt moving) | — | none | — | — | log transition only; reset all counters |
| **APP_MISSING** | heartbeat.json missing/stale (`now − writtenAt > 3×HB_INTERVAL = 15s`) OR VONO process not found | 15s stale, or PID gone | **launch/relaunch VONO** | 3 per 10-min window | 30s between attempts | after 3 fails → BACKOFF (5-min), alert `app_missing` |
| **RENDERER_STALE** | `renderer.alive===false` OR `renderer.lastSeenAt` stale (`> 4×rendererPingMs`) while app.alive | 20s (once renderer ping exists; **reserved** until then) | soft: signal app to reload renderer; if unsupported → treat as APP restart | 2 | 30s | escalate to APP restart after 2 |
| **MPV_DOWN** | `mpv.engineReady===false` for a sustained window while status intends play | 10s | rely on app's own mpv respawn first; if still down → app restart | 2 | 45s | escalate to APP restart; alert `mpv_down` |
| **PLAYBACK_STALLED** | intends play AND **this attempt already proved real progress** AND **attempt age ≥ startup grace** AND `now − playback.positionAt > STALL` — **duration-agnostic** (`duration===0` live/radio counts, its position still advances while healthy) | `STALL = 12s`, `startup grace = 30s` | rely on app self-heal first (renderer redispatch/skip already exists); if still stalled after grace → app restart | 2 | 60s | alert `playback_stalled`; never faster than the app's own 30s/60s startup machine |
| **RECOVERING** | a recovery action was issued and we await HEALTHY | wait `RECOVERY_CONFIRM = 20s` | none (observe) | — | — | if HEALTHY within window → RECOVERED (log); else next escalation step |
| **MAINTENANCE** | valid `control.json`: `mode!="none"` AND `now < expiresAt` (+ bootId match once available) | — | **suppress ALL recovery** | — | — | log `maintenance_active(reason, expiresAt)`; auto-exit when expired |

**Precedence each tick:** `MAINTENANCE` > `RECOVERING` > `APP_MISSING` > `MPV_DOWN` >
`PLAYBACK_STALLED` > `RENDERER_STALE` > `HEALTHY`. Maintenance wins over everything; a fresh recovery
in flight is not re-triggered.

**Golden rule — defer to the app first.** The app already self-heals (mpv respawn, renderer freeze
redispatch, 30s/60s stream-startup machine, skip-forward). The watchdog is the *outer* ring: it only
acts when the app can no longer help itself (process gone, or a signal stuck past the app's own
longest self-heal). Watchdog thresholds are deliberately looser than the app's internal ones so the
two never fight.

---

## D. File / process layout

```
C:\ProgramData\VONO\
  state\
    heartbeat.json      # WRITER = VONO main (atomic tmp+rename, ~1/s). READER = watchdog.
    control.json        # WRITER = app/admin (maintenance). READER = watchdog. Self-expiring.
  logs\
    watchdog.log        # watchdog transitions + actions (sanitized: no url/token)
    restart-history.json# rolling ring of {at, fromState, action, result} (bounded, e.g. last 200)

Program files (per-machine or per-user install):
  <install>\SyncBiz Player.exe      # the GUI app (unchanged)
  <install>\resources\app.asar      # RC3 mpv-manager etc.
  <install>\vono-watchdog\vono-watchdog.exe   # OR a sibling install; independent binary

Repo layout (new, additive):
  desktop/src/shared/vono-runtime-state.ts   # ⭐ SINGLE SOURCE OF TRUTH for the schema:
                                             #   heartbeat + control/maintenance + health states
                                             #   (WatchdogState / RecoveryAction). Landed by PR-A;
                                             #   PR-B extends it with the health-state types.
  desktop/watchdog/                           # the external watchdog (this design's POC)
    contract.ts        # NO schema copy — re-exports desktop/src/shared/vono-runtime-state.ts and
                       #   only ADDS watchdog operational thresholds (WD). One contract, zero drift.
    state-machine.ts   # PURE evaluate(hb, control, now, prev) → {state, reason, action}
    observer.ts        # read-only loop (POC: observe + log; NO recovery yet)
    README.md
```

### Single-contract rule (no schema duplication)
`desktop/src/shared/vono-runtime-state.ts` is the **only** definition of `VonoHeartbeat`,
`VonoControlState`, and the health-state enums `WatchdogState` / `RecoveryAction`. Both sides consume
it: the app-side writer + future fleet-telemetry client, and the external watchdog (`contract.ts` does
`export * from "../src/shared/vono-runtime-state"` and adds only the operational `WD` thresholds).
PR-A lands the heartbeat/control schema; **PR-B adds `WatchdogState`/`RecoveryAction` to that same
shared file** and rewrites the watchdog's `contract.ts` to re-export it — so the POC's current
standalone `contract.ts` is a temporary bootstrap that is replaced (not committed) the moment PR-A's
shared file is on PR-B's base.

- **Writer/reader ACL:** the user-session app creates `…\VONO` and writes `state\`. A future
  LocalSystem reader can already read under ProgramData. Since we chose a **user-session** watchdog
  (§B), both run as the same user → no ACL work needed for P0.
- **Atomicity:** all state files use tmp+rename so the reader never sees a partial file.

---

## E. Recovery thresholds (summary)

| Constant | Value | Why |
|---|---|---|
| `HB_INTERVAL` | 5000 ms | from heartbeat (source of truth) |
| watchdog tick | 2000 ms | responsive without busy-spin |
| APP stale | 3×HB = 15 s | tolerate GC/IO pauses; still fast |
| MPV_DOWN grace | 10 s | let the app respawn mpv first |
| PLAYBACK_STALL | 12 s | > app's 6s freeze watchdog, < user patience (only AFTER proven progress) |
| startup grace | 30 s | a fresh attempt is never STALLED until it proves progress AND is older than this — ≥ the app's stream-startup policy so the watchdog can't fight a 20–30s startup |
| RENDERER stale | 20 s | reserved until renderer ping exists |
| attempts / window | 3 per 10 min (APP), 2 (others) | prevent restart loops |
| inter-attempt cooldown | 30–60 s per state | let a restart settle before judging |
| RECOVERY_CONFIRM | 20 s | time to reach HEALTHY after an action |
| BACKOFF after limit | 5 min | break loops; alert; then retry a bounded number of times |
| hard loop-guard | max 6 full-app restarts / hour → enter SAFE_HOLD (observe+alert only) | absolute anti-loop ceiling |

**Anti-loop:** counters are per-state and per-rolling-window; hitting a limit enters BACKOFF, and a
global ceiling (6 app restarts/hour) enters SAFE_HOLD where the watchdog only observes + alerts (never
silently gives up on playback, but stops hammering a box that cannot recover — a human is paged).

---

## E2. Restart escalation ladder (no loops)

```
signal stuck (past app self-heal)
  step 1: MPV recovery      → let app respawn mpv (observe RECOVERY_CONFIRM)
  step 2: renderer recovery → ask app to reload renderer (if supported)
  step 3: full VONO restart → kill + relaunch SyncBiz Player.exe
  step 4: cooldown (BACKOFF) → wait, bounded retries
  step 5: SAFE_HOLD          → observe + alert only (global ceiling hit)
```
Each step only fires if the previous step didn't reach HEALTHY within its confirm window. Steps 1–2
are cheap/soft; step 3 is the heavy hammer, rate-limited by §E ceilings.

---

## F. Settings design — "VONO Protection"

- **Default ON.** Shown under an **Admin/Technician** area, not normal branch-employee UI.
- Employees cannot disable protection. Admin/Technician can **temporarily** disable it *for
  maintenance* — which writes a bounded, self-expiring `control.json` (never a permanent flag).
- **How the setting reaches the external watchdog safely:** the app does NOT command the watchdog
  directly. The Admin action writes `control.json` (mode=`maintenance`, `reason`, `createdAt`,
  `expiresAt` = now + chosen minutes, capped e.g. ≤ 8h). The watchdog reads it each tick and enters
  MAINTENANCE while valid. When it expires (or the box reboots, once `bootId` exists), protection
  auto-resumes — **no way to leave a branch permanently unprotected.**
- Re-enabling early = write `control.json` with `mode="none"` (or delete it). The default (no file)
  means protection ON.
- The "VONO Protection: ON/OFF(until HH:MM)" status is shown read-only to the operator so it's never
  silently off.

---

## G. Fleet Protect telemetry contract (design only — no Control Room tonight)

Per-device, sent to cloud when online (queued + coalesced when offline; **never blocks local loop**):

```jsonc
// POST /api/fleet/heartbeat  (device-authenticated; body sanitized — no urls/tokens)
{
  "orgId": "…", "branchId": "…", "deviceId": "…",
  "externalBranchId": "…",           // human-facing branch code
  "isMaster": true,                   // holds the WS MASTER lease
  "online": true,                     // derived by cloud from freshness; device just reports
  "playing": true,                    // playback.status === "playing" && progressing
  "lastSeenAt": 1730000000000,        // device wall clock of this report
  "source": { "kind": "playlist|radio|url", "id": "…", "title": "…" }, // title only, never url
  "appVersion": "2.2.8", "mpvVersion": "0.41.0",
  "health": { "state": "HEALTHY|…", "reason": "…" },
  "restart": { "count1h": 0, "lastAt": null, "lastAction": null },
  "protection": { "enabled": true, "maintenanceUntil": null }
}
```
Cloud derives Online/Offline (freshness), Playing/Not-Playing, Last Seen, version skew, restart
trends, crash trends, and raises alerts. Remote restart (later) = cloud writes a bounded command the
device/watchdog consumes (same self-expiring pattern as control.json). **Not built tonight.**

---

## H. P0 implementation plan (small PRs)

| PR | Scope | Risk | Touches playback? |
|---|---|---|---|
| **PR-A** | Re-land heartbeat writer rebased on main; feed from the single `broadcast` chokepoint; keep contract + paths verbatim | low | no (main-process observer only) |
| **PR-B** | Add `WatchdogState`/`RecoveryAction` to the shared contract; external watchdog **read-only observer** re-exporting that single contract (no schema copy) + pure state-machine + observe/log loop. No recovery, no launch. | very low | no |
| **PR-C** | Watchdog **recovery actions**: launch/relaunch VONO, escalation ladder, anti-loop ceilings, restart-history | medium (spawns app) | no |
| **PR-D** | **Launch mechanism**: Scheduled Task at logon (+ provisioning notes for auto-logon), watchdog self-restart | medium (OS integration) | no |
| **PR-E** | **control.json** maintenance + Admin/Technician Settings surface (self-expiring) | low | no |
| **PR-F** | **Fleet telemetry** client (queued, offline-safe) + minimal cloud ingest | medium | no |
| **PR-G** | Renderer→main ping to light up the RENDERER signal (removes the reserved `null`) | low | renderer only, additive |

Ordering: A → B → C → D → E → F → G. Each PR is additive, independently revertible, and never edits
the playback chain (`audio-player.tsx`, `device-player-context.tsx`, `playback-provider.tsx`,
`mpv-manager.ts` playback logic). Heartbeat/Watchdog stay out of the hot path.

**Tonight's POC = PR-B** (read-only observer + pure state machine), shipped as code in
`desktop/watchdog/` on this branch for review — no commit until approved, no merge, no deploy, no
installer.
